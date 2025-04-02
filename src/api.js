import axios from 'axios';
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

export default api
