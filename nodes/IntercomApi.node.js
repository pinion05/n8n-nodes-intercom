'use strict';

/**
 * Intercom API — pi-intercom 브로커 HTTP 게이트웨이(intercom-web) 커스텀 노드
 * 게이트웨이: GET /health, GET /sessions, POST /send {to,text}, POST /broadcast {text}
 * 참고: ~/.pi/agent/skills/intercom-api (로컬 스킬)
 */

class IntercomApi {
	constructor() {
		this.description = {
			displayName: 'Intercom API',
			name: 'intercomApi',
			icon: 'file:intercom.svg',
			group: ['transform'],
			version: 1,
			subtitle: '={{$parameter["operation"]}}',
			description: '살아있는 pi 세션 조회·메시지 주입 (intercom-web 게이트웨이)',
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
					description: '수신 pi 세션 (id 또는 name) — 목록에서 선택',
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
						{ name: 'List Sessions', value: 'list', description: '살아있는 pi 세션 목록 (GET /sessions)' },
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
					const res = await this.helpers.httpRequest({ url: `${baseUrl}/sessions`, json: true });
					const sessions = (res.sessions || [])
						.filter((s) => s && s.id)
						.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)); // 최근 활동순
					return sessions.map((s) => ({
						// 표시: 이름 · 모델 (상태) · id앞 8자리 — 유니크 식별자 포함
						name: `${s.name || s.id}${s.model ? ` · ${s.model}` : ''}${s.status ? ` (${s.status})` : ''} · ${String(s.id).slice(0, 8)}`,
						value: s.id,
					}));
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

			let response;
			if (resource === 'session') {
				if (operation === 'health') {
					response = await this.helpers.httpRequest({ method: 'GET', url: `${baseUrl}/health`, json: true });
				} else {
					response = await this.helpers.httpRequest({ method: 'GET', url: `${baseUrl}/sessions`, json: true });
					// 세션마다 한 아이템 — 다음 노드에서 iterate하기 편하게
					for (const s of response.sessions || []) results.push({ json: s });
					continue;
				}
			} else {
				const text = this.getNodeParameter('text', i);
				let body;
				if (operation === 'broadcast') {
					body = { text };
					response = await this.helpers.httpRequest({
						method: 'POST', url: `${baseUrl}/broadcast`, json: true, body,
					});
				} else {
					body = { to: this.getNodeParameter('to', i), text };
					response = await this.helpers.httpRequest({
						method: 'POST', url: `${baseUrl}/send`, json: true, body,
					});
				}
			}
			results.push({ json: response });
		}

		return [results];
	}
}

module.exports = { IntercomApi };
