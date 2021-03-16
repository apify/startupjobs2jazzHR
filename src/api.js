const axios = require('axios');
const _ = require('underscore');

const api = axios.create();

api.interceptors.request.use((request) => {
  console.log('Starting Request', request.url);
  if (request.method === 'post') console.log(_.omit(request.data, 'apikey', 'base64-resume'));
  return request;
});

api.interceptors.response.use(
  (res) => {
    // jazzHR posts
    if (res.data && res.data._error) {
      throw new Error(res.data._error);
    }
    return res;
  },
  (err) => {
    throw new Error(err.response.data.message);
  },
);

module.exports = api;
