// Claude 아티팩트 빌드에는 API 키 경로(공식 SDK)가 필요 없어 빈 자리만 둔다. AI는 sample 기능으로 처리한다.
class APIError extends Error {}
export default class Anthropic { constructor() { throw new Error('Claude 아티팩트에서는 API 키 경로를 쓰지 않아요.'); } }
for (const name of ['APIError', 'APIConnectionError', 'APIConnectionTimeoutError', 'APIUserAbortError', 'AuthenticationError', 'PermissionDeniedError', 'RateLimitError', 'BadRequestError', 'NotFoundError']) Anthropic[name] = class extends APIError {};
