import Promise from 'bluebird';
import { log } from 'apify';

import api from './api.js';
import { ASHBY_GET_APPLICATIONS_CONCURRENCY, ERROR_TYPES, RESUME_KEYWORDS } from './consts.js';

export default class AshbyClient {
  constructor(token) {
    this.url = 'https://api.ashbyhq.com';
    this.token = token;
  }

  /**
   * Return open jobs from Ashby, following pagination to the end.
   * @returns {Promise<array>} job list
   */
  async openJobList() {
    const headers = { Authorization: `Basic ${this.token}` };
    let results = [];
    let cursor;
    let moreDataAvailable = true;

    while (moreDataAvailable) {
      const body = cursor ? { status: ['Open'], cursor } : { status: ['Open'] };
      const { data } = await api.post(`${this.url}/job.list`, body, { headers });

      if (data.success === false) {
        throw new Error(`Ashby job.list failed: ${JSON.stringify(data.errors)}`);
      }

      results = [...results, ...data.results];
      cursor = data.nextCursor;
      // Guard against a truthy flag with no cursor, which would otherwise spin forever.
      moreDataAvailable = !!data.moreDataAvailable && !!cursor;
    }

    return results;
  }

  /**
   * Finds an existing Ashby candidate by email address.
   * Ashby searches by email and/or name, so the returned rows are confirmed against the address we
   * asked for rather than trusting the first result.
   * @param {string} email
   * @returns {Promise<object|null>} candidate, or null when there is no exact match
   */
  async findCandidateByEmail(email) {
    if (!email) return null;

    const { data } = await api.post(`${this.url}/candidate.search`, { email }, {
      headers: { Authorization: `Basic ${this.token}` },
    });

    // Fails closed: returning null here would read as "no such candidate" and duplicate them.
    if (data.success === false) {
      throw Object.assign(new Error(ERROR_TYPES.SEARCH_CANDIDATE), { errors: data.errors, email });
    }

    const wanted = email.trim().toLowerCase();
    const matches = ({ value }) => value?.trim().toLowerCase() === wanted;

    return (data.results || []).find((candidate) => (
      matches(candidate.primaryEmailAddress || {}) || (candidate.emailAddresses || []).some(matches)
    )) || null;
  }

  /**
   * Returns the ids of the jobs a candidate already has applications on.
   * application.list has no candidate filter. Passing one is silently accepted and ignored, and the
   * whole organisation's applications come back, so the candidate's own applicationIds are resolved
   * individually instead.
   * @param {string[]} applicationIds
   * @returns {Promise<string[]>} job ids
   */
  async candidateApplicationJobIds(applicationIds) {
    const headers = { Authorization: `Basic ${this.token}` };

    const jobIds = await Promise.map(applicationIds, async (applicationId) => {
      const { data } = await api.post(`${this.url}/application.info`, { applicationId }, { headers });

      // Throws rather than returning a partial answer, which would read as "not applied yet" and
      // duplicate the application. The context rides on the error so the caller logs it once.
      if (data.success === false) {
        throw Object.assign(new Error(ERROR_TYPES.FETCH_APPLICATION), { errors: data.errors, applicationId });
      }

      return data.results?.job?.id;
    }, { concurrency: ASHBY_GET_APPLICATIONS_CONCURRENCY });

    return jobIds.filter(Boolean);
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
    
    if (data.errors || !data.results?.id) {
      log.error(ERROR_TYPES.CREATE_APPLICANT, {
        message: data.errors,
        applicant: { name: applicant.name, email: applicant.email },
      });

      return null;
    }

    return data.results.id;
  }

  /**
   * POST attachments to the given candidate
   * @param {string} applicantId
   * @param {Array<Object>} attachments
  */
  async uploadAttachments(applicantId, attachments) {
    // Filenames arrive as e.g. "Jan_Novak_CV_EN.pdf", so the keyword has to be matched anywhere in
    // the name. Falls back to index 0, the first document being the likeliest resume.
    const suspectedResumeIndex = Math.max(
      0,
      attachments.findIndex((attachment) => {
        const filename = (attachment.originalFilename || '').toLowerCase();
        return RESUME_KEYWORDS.some((keyword) => filename.includes(keyword));
      })
    );

    return Promise.all(attachments.map(async (attachment, i) => {
      try {
        const fileResponse = await api.get(attachment.url, { responseType: 'arraybuffer' });

        const file = new Uint8Array(fileResponse.data).buffer;
        const fileName = attachment.originalFilename;
        const fileType = fileResponse.headers['content-type'];

        return i === suspectedResumeIndex
          ? this.uploadResume(applicantId, file, fileName, fileType)
          : this.uploadAttachment(applicantId, file, fileName, fileType);
      } catch (err) {
        log.error(ERROR_TYPES.FETCH_ATTACHMENT, { message: err.message, url: attachment.url, applicantId });
        return false;
      }
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

  async createApplication(jobId, candidateId) {
    const { data } = await api.post(`${this.url}/application.create`, {
      candidateId,
      jobId,
      interviewStageId: 'FirstPreInterviewScreen',
      sourceId: '4a3af47a-28a7-462d-a8c5-edb55668b8c1', // StartupJobs inbound
    }, { headers: { Authorization: `Basic ${this.token}` } });
    // Throws so the caller stops here: nothing else may be attached to a candidate who never got
    // onto the job, or the next run would add a second copy of it.
    if (data.errors) {
      throw Object.assign(new Error(ERROR_TYPES.CREATE_APPLICATION), { errors: data.errors, candidateId, jobId });
    }
  }
}
