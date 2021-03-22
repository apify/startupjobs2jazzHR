const axios = require('axios');
const _ = require('underscore');
const { log } = require('./utils');

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

module.exports = api;
