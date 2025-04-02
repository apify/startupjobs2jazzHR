const api = require('./api');
const { ERROR_TYPES } = require('./consts');
const { log } = require('./utils');

class AshbyClient {
  constructor(token) {
    this.url = 'https://api.ashbyhq.com';
    this.token = token;
  }

  /**
   * Return open jobs from Ashby
   * @returns {array} job list
   */
  async openJobList() {
    const { data } = await api.post(`${this.url}/job.list`, { data: { status: ['Open'] } });
    return data;
  }

  async applicantDetail(id) {
    const { data } = await api.get(`${this.url}/candidate.info`, { data: { id } });
    return data;
  }

  /**
   * Recursively gets all applicant/jobs records. By default jazzHR only provides 100 results per page
   * @param {string} cursor
   * @returns {array} applicant/job record
   */
  async applicants2JobsList(cursor) {
    let { data } = await api.get(`${this.url}/candidate.list`, cursor ? { data: { cursor } } : {});
    if (data.moreDataAvailable) {
      data = [...data, ...await this.applicants2JobsList(data.cursor)];
    }
    return data;
  }

  /**
   * Gets details for provided applicant ids
   * @param {array} applicantIds
   * @returns {array} applicants details
   */
  async applicantsWithDetails(applicantIds) {
    return Promise.all(applicantIds.map(((id) => this.applicantDetail(id))));
  }

  /**
   * POST applicant to jazzHR
   * @param {object} applicant
   * @returns {string} applicant id
   */
  async createApplicant(applicant) {
    const { data } = await api.post(`${this.url}/candidate.create`, this.postConfig(applicant));
    if (data.errors) {
      log.error(ERROR_TYPES.CREATE_APPLICANT, { message: data._error });
    }
    return data.results.id;
  }

  /**
   * POSTs note to the given applicant
   * @param {string} applicant_id
   * @param {string} contents
   */
  async createNote(applicant_id, contents) {
    const { data } = await api.post(`${this.url}/candidate.createNote`, {
      candidateId: applicant_id,
      note: contents,
    });
    if (data.errors) {
      log.error(ERROR_TYPES.CREATE_NOTE, { message: data._error });
    }
  }
}

module.exports = AshbyClient;
