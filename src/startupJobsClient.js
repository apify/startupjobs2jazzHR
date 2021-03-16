const moment = require('moment');
const Promise = require('bluebird');
const api = require('./api');

/**
 * StartupJobs endpointes wrapper
 */
class StartupJobsClient {
  constructor(token) {
    this.token = token;
    this.url = 'https://api.startupjobs.cz/company';
    this.dateFormat = 'YYYY-MM-DDThh:mm:ss';
  }

  /**
   * GET requests axios config
   * @param {object} options
   * @returns {object} axios config
   */
  getConfig(options = {}) {
    return {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.token}`,
      },
    };
  }

  /**
   * Gets array of applications from given date. If not date provided return all applications
   * @param {string} from date string
   * @returns {array} applications
   */
  async applicationList(from) {
    const { data } = await api.get(`${this.url}/applications`, this.getConfig({
      params: {
        'created_at.gt': from ? moment(from).format(this.dateFormat) : null,
      },
    }));
    return data;
  }

  /**
   * Gets details for all given ids
   * @param {array} applicationIds
   * @returns {array} applications details
   */
  async applicationsWithDetails(applicationIds) {
    const res = await Promise.map(applicationIds, async (id) => {
      const detail = await this.applicationDetail(id);
      return detail;
    }, { concurrency: 20 });

    return res.sort((a, b) => {
      const aDate = moment(a.created_at, this.dateFormat);
      const bDate = moment(b.created_at, this.dateFormat);
      return bDate.diff(aDate);
    });
  }

  /**
   * Gets details for application
   * @param {string} id
   * @returns {object} application details
   */
  async applicationDetail(id) {
    const { data } = await api.get(`${this.url}/applications/${id}`, this.getConfig());

    return data;
  }

  /**
   * Gets attachment in base64 string
   * @param {string} url
   * @returns {string} base64
   */
  async getBase64Attachment(url) {
    const { data } = await api.get(url, this.getConfig({
      responseType: 'arrayBuffer',
      responseEncoding: 'binary',
    }));

    return Buffer.from(data, 'binary').toString('base64');
  }
}

module.exports = StartupJobsClient;
