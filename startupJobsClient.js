const moment = require('moment');
const Promise = require('bluebird');
const { api } = require('./api');

class StartupJobsClient {
  constructor(token) {
    this.token = token;
    this.url = 'https://api.startupjobs.cz/company';
    this.dateFormat = 'YYYY-MM-DDThh:mm:ss';
  }

  getConfig(options = {}) {
    return {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.token}`,
      },
    };
  }

  async applications(from) {
    const { data } = await api.get(`${this.url}/applications`, this.getConfig({
      params: {
        'created_at.gt': from ? moment(from).format(this.dateFormat) : null,
      },
    }));
    return data;
  }

  async applicationsWithDetails(applicationIds) {
    // const res = [];
    // for (let i = 0; i < applications.length; i += 1) {
    //   const detail = await this.application(applications[i].id);
    //   res.push(detail);
    // }

    const res = await Promise.map(applicationIds, async (id) => {
      const detail = await this.application(id);
      return detail;
    }, { concurrency: 20 });

    return res.sort((a, b) => {
      const aDate = moment(a.created_at, this.dateFormat);
      const bDate = moment(b.created_at, this.dateFormat);
      return bDate.diff(aDate);
    });
  }

  async application(id) {
    const { data } = await api.get(`${this.url}/applications/${id}`, this.getConfig());

    return data;
  }

  async offers() {
    const { data } = await api.get(`${this.url}/offers`, this.getConfig());

    return data;
  }
}

exports.StartupJobsClient = StartupJobsClient;
