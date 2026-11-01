import { localize } from '../../../../site-settings/shared/localize.mjs';

const messages = {
  address: '参考链接需要使用公开的 HTTP/HTTPS 网页地址',
  private: '参考资料链接不能访问本机或私有网络',
  dns: '无法解析网页地址，请检查网址。',
  redirect_dns: '网页跳转后的地址无法解析。',
  redirect: '网页返回了无效的跳转地址。',
  redirects: '参考链接重定向次数过多',
  timeout: '读取网页超时，请稍后重试。',
  network: '无法连接网页，请稍后重试。',
  forbidden: '网站拒绝了读取请求（HTTP 403）。',
  challenge: '网站需要浏览器验证，当前工具无法直接读取。',
  missing: '网页不存在（HTTP 404），请检查地址。',
  http: '网页返回 HTTP {0}，无法读取。',
  size: '参考资料超过 8 MB，请下载后按需上传',
  format: '链接未返回可阅读的网页、文本或 PDF',
};

export class WebReadError extends Error {
  constructor(kind, values = [], cause) {
    if (!Object.hasOwn(messages, kind)) throw new TypeError('Unknown web reading error');
    super(localize(messages[kind], 'zh-CN', values), cause ? { cause } : undefined);
    this.name = 'WebReadError';
    this.kind = kind;
    this.values = values;
  }
}

// The SDK can wrap a tool exception. Only these known messages may pass the
// chat's error filter; arbitrary provider errors keep their existing redaction.
export function webReadErrorMessage(error, language) {
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (current instanceof WebReadError) return localize(messages[current.kind], language, current.values);
  }
  return null;
}

export function webNetworkError(error, signal) {
  if (signal?.aborted) return signal.reason;
  if (error instanceof WebReadError) return error;
  if (['ABORT_ERR', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.code) || error?.name === 'TimeoutError')
    return new WebReadError('timeout', [], error);
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(error?.code)) return new WebReadError('dns', [], error);
  return new WebReadError('network', [], error);
}
