const Promise = require('bluebird');
const { api } = require('./api');

class JazzHRClient {
  constructor(token) {
    this.token = token;
    this.url = 'https://api.resumatorapi.com/v1';
  }

  getConfig(options = {}) {
    return {
      ...options,
      params: {
        ...options.params,
        apikey: this.token,
      },
    };
  }

  async jobs() {
    const { data } = await api.get(`${this.url}/jobs`, this.getConfig());
    return data;
  }

  async applicants(page = 1) {
    let { data } = await api.get(`${this.url}/applicants/page/${page}`, this.getConfig());
    if (data.length > 0) {
      data = [...data, ...await this.applicants(page + 1)];
    }
    return data;
  }

  async applicant(id) {
    const { data } = await api.get(`${this.url}/applicants/${id}`, this.getConfig());
    return data;
  }

  async applicants2JobsList(page = 1) {
    let { data } = await api.get(`${this.url}/applicants2jobs/page/${page}`, this.getConfig());
    if (data.length > 0) {
      data = [...data, ...await this.applicants2JobsList(page + 1)];
    }
    return data;
  }

  async applicantsWithDetails(applicantIds) {
    // const res = [];
    // for (let i = 0; i < applicants.length; i += 1) {
    //   const detail = await this.applicant(applicants[i].id);
    //   res.push(detail);
    // }

    const res = await Promise.map(applicantIds, async (id) => {
      const detail = await this.applicant(id);

      return detail;
    }, { concurrency: 50 });

    return res;
  }
}

exports.JazzHRClient = JazzHRClient;
