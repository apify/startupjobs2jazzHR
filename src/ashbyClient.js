import { log } from 'apify';

import api from './api.js';
import { ERROR_TYPES, RESUME_KEYWORDS } from './consts.js';

export default class AshbyClient {
  constructor(token) {
    this.url = 'https://api.ashbyhq.com';
    this.token = token;

    this.retryCount = 5;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Generic retry wrapper for API calls with exponential backoff
   * @param {Function} apiCall - The API call function to execute
   * @param {string} operationName - Name of the operation for logging
   * @returns {Promise<any>} Result of the API call
   */
  async withRetry(apiCall, operationName) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        const statusCode = error.response?.status ?? 500;

        const shouldRetry = statusCode >= 500;
        const isLastAttempt = attempt === this.retryCount;
        
        if (shouldRetry && !isLastAttempt) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          log.warning(`${operationName}: Ashby API returned ${statusCode}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.retryCount})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          log.error(`${operationName}_ERROR`, { 
            message: `${operationName} failed after ${attempt + 1} attempts`, 
            error: error.message,
            status: error.response?.status 
          });
          
          throw error;
        }
      }
    }
  }

  /**
   * Return open jobs from Ashby
   * @returns {array} job list
   */
  async openJobList() {
    return this.withRetry(
      async () => {
        const { data } = await api.post(`${this.url}/job.list`, { data: { status: ['Open'] } }, { headers: { Authorization: `Basic ${this.token}` } });
        return data.results;
      },
      'OPEN_JOB_LIST'
    );
  }

  async applicantDetail(id) {
    return this.withRetry(
      async () => {
        const { data } = await api.post(`${this.url}/candidate.info`, { data: { id } }, { headers: { Authorization: `Basic ${this.token}` } });
        return data.results;
      }, 
      'APPLICANT_DETAIL'
    );
  }

  /**
   * Recursively gets all applicant/jobs records. By default Ashby only provides 100 results per page
   * @param {string} cursor
   * @returns {array} applicant/job record
   */
  async applicants2JobsList(cursor) {
    let results = [];
    
    const { data } = await this.withRetry(
      async () => {
        return await api.post(`${this.url}/candidate.list`, cursor ? { cursor } : {}, { headers: { Authorization: `Basic ${this.token}` } });
      },
      'APPLICANTS_TO_JOBS_LIST'
    );
    
    if (data.moreDataAvailable) {
      results = [...data.results, ...await this.applicants2JobsList(data.nextCursor)];
    } else {
      results = [...results, ...data.results];
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
