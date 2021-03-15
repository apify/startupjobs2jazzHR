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

  postConfig(data) {
    return {
      ...data,
      apikey: this.token,
    };
  }

  async jobList() {
    const { data } = await api.get(`${this.url}/jobs`, this.getConfig());
    return data;
  }

  async applicantList(page = 1) {
    let { data } = await api.get(`${this.url}/applicants/page/${page}`, this.getConfig());
    if (data.length > 0) {
      data = [...data, ...await this.applicantList(page + 1)];
    }
    return data;
  }

  async applicantDetail(id) {
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
    const res = await Promise.map(applicantIds, async (id) => {
      const detail = await this.applicantDetail(id);
      return detail;
    }, { concurrency: 30 });

    return res;
  }

  async createApplicant(applicant) {
    const { data } = await api.post(`${this.url}/applicants`, this.postConfig(applicant));
    return data.prospect_id;
  }

  async createNote(applicant_id, contents) {
    await api.post(`${this.url}/notes`, this.postConfig({
      applicant_id,
      contents,
      user_id: 'usr_anonymous',
      security: 1,
    }));
  }
}

exports.JazzHRClient = JazzHRClient;
