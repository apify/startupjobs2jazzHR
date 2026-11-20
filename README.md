# StartupJobs2JazzHR
This actor (see [Apify Actor documentation](https://docs.apify.com/actor) for more info on Apify actors) transfers job applications from StartupJobs that are connected to a job offer that exists in JazzHR and puts them into JazzHR. The transferred applications are saved into the dataset so that on consecutive runs, they are not processed again. 

For example, if the job application is for a backend developer in StartupJobs, but this job offer does not exist on JazzHR, the application will not be transferred.    
To pair StartupJobs job offers with those in JazzHR, the offers simply need to have their names equal.   

The actor is built on [StartupJobs API](https://www.startupjobs.cz/dev/public-api) and [JazzHR API](http://www.resumatorapi.com/v1/).

## Input
The StartupJobs and JazzHR token are needed so that the actor can use their public APIs.    
​
To get a StartupJobs token you need to contact their support.    
​
[Here is how to get your JazzHR token](https://success.jazzhr.com/hc/en-us/articles/222540508-API-Overview#whereiskey).
```
{
    "startupJobsToken": "your StartupJobs api token",
    "jazzHRToken": "your JazzHR api token"
}
```
## Run state
The actor keeps no state of its own. Ashby decides what was already transferred: an applicant is matched to an existing candidate by email, and an application is skipped when that candidate already applied to the same job.

## Process overview
1. Loads open Ashby jobs and the optional `jobTitleMapping` overrides.
2. Gets today's StartupJobs applications whose offer matches an open Ashby job.
3. Transfers each one to Ashby, reusing the candidate when they already exist and skipping jobs they already applied to.

## Documentation reference
- [Apify SDK](https://sdk.apify.com/)
- [Apify Actor documentation](https://docs.apify.com/actor)
- [Apify CLI](https://docs.apify.com/cli)
- [StartupJobs API](https://www.startupjobs.cz/dev/public-api)
- [JazzHR API](http://www.resumatorapi.com/v1/)