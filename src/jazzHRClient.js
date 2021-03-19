const Promise = require('bluebird');
const api = require('./api');
const { ERROR_TYPES } = require('./consts');

/**
 * Class wrapping jazzHr endpoints
 */
class JazzHRClient {
  constructor(token) {
    this.token = token;
    this.url = 'https://api.resumatorapi.com/v1';
  }

  /**
   * Axios configuration for GET requests
   * @param {object} options
   * @returns {object} axios config
   */
  getConfig(options = {}) {
    return {
      ...options,
      params: {
        ...options.params,
        apikey: this.token,
      },
    };
  }

  /**
   * Axios configuration for POST request
   * @param {object} data
   * @returns {object} axios config
   */
  postConfig(data) {
    return {
      ...data,
      apikey: this.token,
    };
  }

  /**
   * Return jobs from jazzHR
   * @returns {array} job list
   */
  async jobList() {
    const { data } = await api.get(`${this.url}/jobs`, this.getConfig());
    return data;
  }

  /**
   * Return applicant detail
   * @param {string} id
   * @returns {object} applicant detail
   */
  async applicantDetail(id) {
    const { data } = await api.get(`${this.url}/applicants/${id}`, this.getConfig());
    return data;
  }

  /**
   * Recuresively gets all applicant/jobs records. By default jazzHR only provides 100 results per page
   * @param {number} page
   * @returns {array} applicant/job record
   */
  async applicants2JobsList(page = 1) {
    let { data } = await api.get(`${this.url}/applicants2jobs/page/${page}`, this.getConfig());
    if (data.length > 0) {
      data = [...data, ...await this.applicants2JobsList(page + 1)];
    }
    return data;
  }

  /**
   * Gets details for provided applicant ids
   * @param {array} applicantIds
   * @returns {array} applicants details
   */
  async applicantsWithDetails(applicantIds) {
    const res = await Promise.map(applicantIds, async (id) => {
      const detail = await this.applicantDetail(id);
      return detail;
    }, { concurrency: 30 });

    return res;
  }

  /**
   * POST applicant to jazzHR
   * @param {object} applicant
   * @returns {string} applicant id
   */
  async createApplicant(applicant) {
    const { data } = await api.post(`${this.url}/applicants`, this.postConfig(applicant));
    if (data._error) {
      const error = {
        type: ERROR_TYPES.CREATE_APPLICANT,
        payload: applicant,
        message: data._error,
      };
      throw new Error(JSON.stringify(error));
    }
    return data.prospect_id;
  }

  /**
   * POSTs note to the given applicant
   * @param {string} applicant_id
   * @param {string} contents
   */
  async createNote(applicant_id, contents) {
    const payload = {
      applicant_id,
      contents,
      user_id: 'usr_anonymous',
      security: 1,
    };
    const { data } = await api.post(`${this.url}/notes`, this.postConfig(payload));
    if (data._error) {
      const error = {
        type: ERROR_TYPES.CREATE_NOTE,
        message: data._error,
        payload,
      };
      throw new Error(JSON.stringify(error));
    }
  }
}

module.exports = JazzHRClient;
