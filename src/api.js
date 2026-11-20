import axios from 'axios';
import axiosRetry from 'axios-retry';
import _ from 'underscore';
import { log } from 'apify';

const RETRY_FACTOR = 1000;

const api = axios.create();

api.interceptors.request.use((request) => {
  let logData = { method: request.method.toUpperCase(), url: request.url };
  if (request.method === 'post') {
    logData = {
      ...logData,
      ..._.omit(request.data, 'apikey', 'base64-resume', 'phoneNumber', 'linkedInUrl'),
    };
  }
  log.info('Starting request', logData);
  return request;
});

axiosRetry(api, {
  retries: 5,
  retryDelay: (retryCount, error) => axiosRetry.exponentialDelay(retryCount, error, RETRY_FACTOR),
  retryCondition: (error) => {
    const status = error.response?.status;
    // 429 included: the Ashby candidate and application lookups multiply the calls per run.
    return status === 429 || status >= 500;
  },
  onRetry: (retryCount, error, requestConfig) => {
    log.warning(`Retrying request to ${requestConfig.url} (attempt ${retryCount}/5) due to ${error.response?.status} error`);
  },
});

/**
 * An AxiosError carries the request config and the raw request/response, which include the
 * Authorization header, and it ends up in logs whole (log.error, uncaught crash dump).
 * Rethrow only what is useful for debugging. Registered after axiosRetry so retries still
 * see the original error.
 */
api.interceptors.response.use(undefined, (error) => {
  if (!axios.isAxiosError(error)) throw error;

  const { config = {}, response } = error;
  const data = response?.data;
  const sanitized = new Error(error.message);
  sanitized.name = 'HttpError';
  Object.assign(sanitized, {
    code: error.code,
    method: config.method?.toUpperCase(),
    url: config.url,
    status: response?.status,
    data: typeof data === 'string' ? data.slice(0, 1000) : (_.isObject(data) && !(data instanceof ArrayBuffer) && !Buffer.isBuffer(data) ? data : undefined),
  });
  // log.error(msg, err) only copies enumerable props, and Error's own `message` is not one.
  Object.defineProperty(sanitized, 'message', { enumerable: true });
  throw sanitized;
});

export default api
