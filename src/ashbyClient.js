import { log } from 'apify';

import api from './api.js';
import { ERROR_TYPES, RESUME_KEYWORDS } from './consts.js';

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
    const { data } = await api.post(`${this.url}/job.list`, { data: { status: ['Open'] } }, { headers: { Authorization: `Basic ${this.token}` } });
    return data.results;
  }

  async applicantDetail(id) {
    const { data } = await api.post(`${this.url}/candidate.info`, { data: { id } }, { headers: { Authorization: `Basic ${this.token}` } });
    return data.results;
  }

  /**
   * Gets candidate records from Ashby. With a syncToken, returns only candidates created/updated
   * since the token was issued. Without one, performs a full sync. Returns a fresh syncToken from
   * the final page so the caller can persist it for the next run.
   * Falls back to a full sync if the provided syncToken is expired/invalid.
   * @param {string} [syncToken]
   * @returns {Promise<{ results: object[], syncToken: string }>}
   */
  async applicants2JobsList(syncToken) {
    const headers = { Authorization: `Basic ${this.token}` };
    const initialBody = syncToken ? { syncToken } : {};

    const { data: firstPage } = await api.post(`${this.url}/candidate.list`, initialBody, { headers });

    if (firstPage.success === false) {
      if (syncToken && firstPage.errors?.some((e) => String(e).toLowerCase().includes('sync_token'))) {
        log.warning('Ashby syncToken invalid/expired, falling back to full sync', { errors: firstPage.errors });
        return this.applicants2JobsList();
      }
      
      throw new Error(`Ashby candidate.list failed: ${JSON.stringify(firstPage.errors)}`);
    }

    let results = [...firstPage.results];
    let nextCursor = firstPage.nextCursor;
    let moreDataAvailable = firstPage.moreDataAvailable;
    let lastSyncToken = firstPage.syncToken;

    while (moreDataAvailable) {
      // Ashby requires both cursor and the original syncToken on every paginated call within a sync session
      const pageBody = syncToken ? { cursor: nextCursor, syncToken } : { cursor: nextCursor };
      const { data: page } = await api.post(`${this.url}/candidate.list`, pageBody, { headers });

      if (page.success === false) {
        throw new Error(`Ashby candidate.list pagination failed: ${JSON.stringify(page.errors)}`);
      }

      results = [...results, ...page.results];
      nextCursor = page.nextCursor;
      moreDataAvailable = page.moreDataAvailable;
      lastSyncToken = page.syncToken || lastSyncToken;
    }

    return { results, syncToken: lastSyncToken };
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
    const { data } = await api.post(`${this.url}/candidate.create`, applicant, {
      headers: { Authorization: `Basic ${this.token}` },
    });
    if (data.errors) {
      log.error(ERROR_TYPES.CREATE_APPLICANT, { message: data.errors });
    }
    return data.results.id;
  }

  /**
   * POST attachments to the given candidate
   * @param {string} applicantId
   * @param {Array<Object>} attachments
  */
  async uploadAttachments(applicantId, attachments) {
    const suspectedResumeIndex = Math.max(
      0,
      attachments.findIndex((attachment) => RESUME_KEYWORDS.includes(attachment.originalFilename.toLowerCase()))
    );

    return Promise.all(attachments.map(async (attachment, i) => {
      const fileResponse = await api.get(attachment.url, { responseType: 'arraybuffer' });

      if (fileResponse.data.errors) {
        log.error(ERROR_TYPES.FETCH_ATTACHMENT, { message: fileResponse.data.errors });
        return false;
      }

      const file = new Uint8Array(fileResponse.data).buffer;
      const fileName = attachment.originalFilename;
      const fileType = fileResponse.headers['Content-Type'];

      return i === suspectedResumeIndex
        ? this.uploadResume(applicantId, file, fileName, fileType)
        : this.uploadAttachment(applicantId, file, fileName, fileType);
    }));
  }

  /**
   * POST an attachment for a specific applicant
   * @param {string} applicantId 
   * @param {TArrayBuffer} file
   * @param {string} fileName
   * @param {string} fileType
   * @return {Promise<boolean>} success
   */
  async uploadAttachment(applicantId, file, fileName, fileType) {
      const formData = new FormData();
      
      formData.append('candidateId', applicantId);
      formData.append(
        'file',
        new Blob([file], { type: fileType || 'application/octet-stream' }),
        fileName,
      );

      const { data } = await api.post(
        `${this.url}/candidate.uploadFile`,
        formData,
        { headers: { Authorization: `Basic ${this.token}` } },
      );

      if (data.errors) {
        log.error(ERROR_TYPES.UPLOAD_ATTACHMENT, { message: data.errors });
        return false;
      }

      return true;
  }

  /**
   * POST an attachment for a specific applicant
   * @param {string} applicantId 
   * @param {TArrayBuffer} file
   * @param {string} fileName
   * @param {string} fileType
   * @return {Promise<boolean>} success
   */
  async uploadResume(applicantId, file, fileName, fileType) {
      const formData = new FormData();
      
      formData.append('candidateId', applicantId);
      formData.append(
        'resume',
        new Blob([file], { type: fileType || 'application/octet-stream' }),
        fileName,
      );

      const { data } = await api.post(
        `${this.url}/candidate.uploadResume`,
        formData,
        { headers: { Authorization: `Basic ${this.token}` } },
      );

      if (data.errors) {
        log.error(ERROR_TYPES.UPLOAD_RESUME, { message: data.errors });
        return false;
      }

      return true;
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
    }, { headers: { Authorization: `Basic ${this.token}` } });
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
    }, { headers: { Authorization: `Basic ${this.token}` } });
    if (data.errors) {
      log.error(ERROR_TYPES.CREATE_NOTE, { message: data.errors });
    }
  }
}
