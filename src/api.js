const axios = require('axios');
const _ = require('underscore');

const api = axios.create();

api.interceptors.request.use((request) => {
  console.log(request.method.toUpperCase(), request.url);
  if (request.method === 'post') console.log(JSON.stringify(_.omit(request.data, 'apikey', 'base64-resume')));
  return request;
});

/**
 * Throws errors to client to stop the actor run
 * Next schedule run will retry where it left off
 */
api.interceptors.response.use(
  (res) => {
    // jazzHR posts
    if (res.data && res.data._error) {
      throw new Error(res.data._error);
    }
    return res;
  },
);

module.exports = api;
