const axios = require('axios');

const api = axios.create();

api.interceptors.request.use((request) => {
  console.log('Starting Request', request.url);
  return request;
});

exports.api = api;
