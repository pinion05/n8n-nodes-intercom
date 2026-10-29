'use strict';

/**
 * Intercom API — pi-intercom 브로커 HTTP 게이트웨이(intercom-web) 커스텀 노드
 * 게이트웨이: GET /health, GET /sessions, POST /send {to,text}, POST /broadcast {text}
 * 참고: ~/.pi/agent/skills/intercom-api (로컬 스킬)
 *
 * 0.3.0 버그 수정 (2026-10-29):
 *  - gateway 4xx/5xx 시 throw → 실행 전체 error + 후속 보고 유실 (undefined to → 400 실측 사건)
 *    대신 클린 실패 출력 {ok:false, error, ...} (Pi/Zai 노드와 동일 패턴)
 *  - to·text 빈 값(죽은 세션 드롭다운 값, 표현식 실패)을 호출 전 검증
 *  - List/Health는 스냅샷 조회 — N아이템이어도 1회만 호출 (기존엔 N×세션수 아이템 중복 출력)
 *  - getSessions 실패 시 예외 대신 '(게이트웨이 접속 실패)' 옵션 반환
 */

function errText(e) {
	const code = e && e.response && e.response.statusCode ? `${e.response.statusCode} ` : '';
	return `${code}${String((e && e.message) || e).slice(0, 300)}`;
}

// 게이트웨이는 죽은 세션에도 HTTP 200 + {ok:true, delivered:false, reason:'Session not found'}를 준다
// (2026-10-29 실측) — delivered:false면 ok:false로 매핑해야 후속 IF 분기가 $json.ok만 보고도 정확해진다
function wrapSendResult(response) {
	if (!response || typeof response !== 'object') return { ok: true, response };
	const delivered = response.delivered;
	return { ok: delivered !== false, delivered, ...response };
}

class IntercomApi {
	constructor() {
		this.description = {
			displayName: 'Intercom API',
			name: 'intercomApi',
			icon: 'file:intercom.svg',
			group: ['transform'],
			version: 1,
			subtitle: '={{$parameter["operation"]}}',
			description: '살아있는 pi 세션 조회·메시지 주입 (intercom-web 게이트웨이) — 실패 시 throw 없이 ok:false 출력',
			defaults: { name: 'Intercom API' },
			inputs: ['main'],
			outputs: ['main'],
			properties: [
				{
					displayName: 'Gateway Base URL',
					name: 'baseUrl',
					type: 'string',
					required: true,
					default: 'http://127.0.0.1:8891',
					placeholder: 'http://127.0.0.1:8891',
					description: 'intercom-web 게이트웨이 URL (원격이면 해당 호스트 IP:8891)',
				},
				{
					displayName: 'Resource',
					name: 'resource',
					type: 'options',
					noExpression: true,
					options: [
						{ name: 'Message', value: 'message', description: '세션에 메시지 주입' },
						{ name: 'Session', value: 'session', description: '세션/게이트웨이 조회' },
					],
					default: 'message',
				},
				{
					displayName: 'Operation',
					name: 'operation',
					type: 'options',
					noExpression: true,
					displayOptions: { show: { resource: ['message'] } },
					options: [
						{ name: 'Send', value: 'send', description: '특정 세션에 메시지 주입 (POST /send)' },
						{ name: 'Broadcast', value: 'broadcast', description: '전체 세션 일괄 주입 (POST /broadcast)' },
					],
					default: 'send',
				},
				{
					displayName: 'To (세션)',
					name: 'to',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getSessions' },
					displayOptions: { show: { resource: ['message'], operation: ['send'] } },
					default: '',
					required: true,
					description: '수신 pi 세션 id — 라이브 /sessions 목록에서 선택. 세션 사망 시 값 무효(400) — ok:false로 출력되니 IF로 분기할 것',
				},
				{
					displayName: 'Text',
					name: 'text',
					type: 'string',
					displayOptions: { show: { resource: ['message'] } },
					default: '',
					required: true,
					description: '주입할 메시지 본문',
				},
				{
					displayName: 'Operation',
					name: 'operation',
					type: 'options',
					noExpression: true,
					displayOptions: { show: { resource: ['session'] } },
					options: [
						{ name: 'List Sessions', value: 'list', description: '살아있는 pi 세션 목록 (GET /sessions) — 스냅샷 1회 조회' },
						{ name: 'Health', value: 'health', description: '게이트웨이 상태 (GET /health)' },
					],
					default: 'list',
				},
			],
		};

		this.methods = {
			loadOptions: {
				getSessions: async function () {
					let baseUrl = this.getCurrentNodeParameter('baseUrl');
					if (typeof baseUrl !== 'string' || !baseUrl.trim()) baseUrl = 'http://127.0.0.1:8891';
					baseUrl = baseUrl.replace(/\/+$/, '');
					try {
						const res = await this.helpers.httpRequest({ url: `${baseUrl}/sessions`, json: true, timeout: 10000 });
						const sessions = (res.sessions || [])
							.filter((s) => s && s.id)
							.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)); // 최근 활동순
						return sessions.map((s) => ({
							// 표시: 이름 · 모델 (상태) · id앞 8자리 — 유니크 식별자 포함
							name: `${s.name || s.id}${s.model ? ` · ${s.model}` : ''}${s.status ? ` (${s.status})` : ''} · ${String(s.id).slice(0, 8)}`,
							value: s.id,
						}));
					} catch (e) {
						return [{ name: `(게이트웨이 접속 실패 — ${String(e.message).slice(0, 50)})`, value: '' }];
					}
				},
			},
		};
	}

	async execute() {
		const items = this.getInputData();
		const results = [];

		for (let i = 0; i < items.length; i++) {
			const baseUrl = (this.getNodeParameter('baseUrl', i) || 'http://127.0.0.1:8891').replace(/\/+$/, '');
			const resource = this.getNodeParameter('resource', i);
			const operation = this.getNodeParameter('operation', i);

			if (resource === 'session') {
				// 조회(list/health)는 스냅샷 — 아이템 N개여도 첫 아이템에서 1회만 호출 (중복 조회·중복 출력 방지)
				if (i > 0) continue;
				try {
					if (operation === 'health') {
						const response = await this.helpers.httpRequest({ method: 'GET', url: `${baseUrl}/health`, json: true });
						results.push({ json: response && typeof response === 'object' ? { ok: true, ...response } : { ok: true, response } });
					} else {
						const response = await this.helpers.httpRequest({ method: 'GET', url: `${baseUrl}/sessions`, json: true });
						// 세션마다 한 아이템 — 다음 노드에서 iterate하기 편하게
						for (const s of response.sessions || []) results.push({ json: s });
					}
				} catch (e) {
					results.push({ json: { ok: false, resource, operation, error: errText(e) } });
				}
				continue;
			}

			const text = this.getNodeParameter('text', i);
			if (operation === 'broadcast') {
				if (!text || !String(text).trim()) {
					results.push({ json: { ok: false, resource, operation, error: 'validation: text 빈 값 — 주입할 본문 필요' } });
					continue;
				}
				try {
					const response = await this.helpers.httpRequest({ method: 'POST', url: `${baseUrl}/broadcast`, json: true, body: { text } });
					results.push({ json: wrapSendResult(response) });
				} catch (e) {
					results.push({ json: { ok: false, resource, operation, error: errText(e) } });
				}
			} else {
				const to = this.getNodeParameter('to', i);
				if (!to || !String(to).trim()) {
					results.push({ json: { ok: false, resource, operation, to: to || null, error: 'validation: to 빈 값 — 라이브 세션 id 필요 (드롭다운 값은 세션 사망 시 무효화된다)' } });
					continue;
				}
				if (!text || !String(text).trim()) {
					results.push({ json: { ok: false, resource, operation, to, error: 'validation: text 빈 값 — 표현식 평가 결과가 비었다' } });
					continue;
				}
				try {
					const response = await this.helpers.httpRequest({ method: 'POST', url: `${baseUrl}/send`, json: true, body: { to, text } });
					results.push({ json: wrapSendResult(response) });
				} catch (e) {
					results.push({ json: { ok: false, resource, operation, to, error: errText(e) } });
				}
			}
		}

		return [results];
	}
}

module.exports = { IntercomApi };
