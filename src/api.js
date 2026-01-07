import axios from 'axios';
import axiosRetry from 'axios-retry';
import _ from 'underscore';
import { log } from 'apify'

const api = axios.create();

api.interceptors.request.use((request) => {
  let logData = { method: request.method.toUpperCase(), url: request.url };
  if (request.method === 'post') {
    logData = {
      ...logData,
      ..._.omit(request.data, 'apikey', 'base64-resume'),
    };
  }
  log.info('Starting request', logData);
  return request;
});

axiosRetry(api, {
  retries: 5,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return error.response?.status >= 500;
  },
  onRetry: (retryCount, error, requestConfig) => {
    log.warning(`Retrying request to ${requestConfig.url} (attempt ${retryCount}/5) due to ${error.response?.status} error`);
  },
});

export default api
