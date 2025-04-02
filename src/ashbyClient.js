import api from './api.js';
import { ERROR_TYPES } from './consts.js';
import { log } from 'apify';

export default class AshbyClient {
  constructor(token) {
    this.url = 'https://api.ashbyhq.com';
    this.token = token;
  }

  /**
   * Return open jobs from Ashby
   * @returns {array} job list
   */
  async openJobList() {
    const { data } = await api.post(`${this.url}/job.list`, { data: { status: ['Open'] } }, {headers: { Authorization: `Basic ${this.token}` }});
    return data.results;
  }

  async applicantDetail(id) {
    const { data } = await api.post(`${this.url}/candidate.info`, { data: { id } }, { headers: { Authorization: `Basic ${this.token}` } });
    return data.results;
  }

  /**
   * Recursively gets all applicant/jobs records. By default jazzHR only provides 100 results per page
   * @param {string} cursor
   * @returns {array} applicant/job record
   */
  async applicants2JobsList(cursor) {
    let results = []
    let { data } = await api.post(`${this.url}/candidate.list`, cursor ? { data: { cursor } } : {}, { headers: { Authorization: `Basic ${this.token}` } });
    if (data.moreDataAvailable) {
      results = [...data.results, ...await this.applicants2JobsList(data.cursor)];
    }
    return results;
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
    const { data } = await api.post(`${this.url}/candidate.create`, applicant,{
      headers: { Authorization: `Basic ${this.token}` }
    });
    if (data.errors) {
      log.error(ERROR_TYPES.CREATE_APPLICANT, { message: data.errors });
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
    },{headers: { Authorization: `Basic ${this.token}` }});
    if (data.errors) {
      log.error(ERROR_TYPES.CREATE_NOTE, { message: data.errors });
    }
  }

  async createApplication(jobId, applicantId) {
    const { data } = await api.post(`${this.url}/application.create`, {
      candidateId: applicantId,
      jobId,
      interviewStageId: 'FirstPreInterviewScreen',
      sourceId: '4a3af47a-28a7-462d-a8c5-edb55668b8c1', // StartupJobs inbound
    },{headers: { Authorization: `Basic ${this.token}` }});
    if (data.errors) {
      log.error(ERROR_TYPES.CREATE_NOTE, { message: data.errors });
    }
  }
}

