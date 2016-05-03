import _       from 'lodash';
import request from 'request'

class Rancher {

	constructor(options) {

		//Extend default options
		this.options = _.extend({
			hostname: 'rancher-server',
			port: 8080,
			accessKey: '',
			secretKey: ''
		}, options);

		//Create config object
		this.config = {
			rancherUrl: 'http://' + this.options.accessKey + ':' + this.options.secretKey + '@' + this.options.hostname + ':' + this.options.port + '/v1'
		}

	}
	
	/**
	 * Returns a list of project ids.
	 */
	getProjectIds() {
		return new Promise((resolve, reject) => {
			request({
				method: 'GET',
				url: this.config.rancherUrl + '/projects'
			}, (err, response) => {

				//Reject on error
				if(err) return reject(err);

				//Parse the response body and return the project ids
				resolve(
					_.pluck(JSON.parse(response.body).data, 'id')
				);

			});
		});
	}

	/**
	 * Returns a list of hosts for the specified project.
	 */
	getProjectHosts(projectId) {
		return new Promise((resolve, reject) => {
			request({
				method: 'GET',
				url: this.config.rancherUrl + '/projects/' + projectId + '/hosts'
			}, (err, response) => {

				//Reject on error
				if(err) return reject(err);

				//Return the hosts
				resolve(JSON.parse(response.body).data);

			});
		});
	}

	/**
	 * Return the id of a host from its hostname.
	 */
	getHostByIdLabel(labelName, labelValue) {
		return new Promise((resolve, reject) => {
			this.getProjectIds()
			.then((projectIds) => {

				//No project ids? Error.
				if(projectIds.length == 0) {
					return reject('No projects registered on the server.');
				}

				//Load the hosts from each project
				let projectHosts = projectIds.map( this.getProjectHosts.bind(this) );

				//Wait for all hosts to load
				Promise.all(projectHosts)
				.then((values) => {

					let discoveredHostIds = [];

					//Check the hosts in each project for the requested label value
					values.forEach((projectHosts) => {
						projectHosts.forEach((host) => {
							if(host.labels && host.labels[labelName] && host.labels[labelName] == labelValue) {
								discoveredHostIds.push( host.id );
							}
						});
					});

					//Resolve with the host ids
					resolve(discoveredHostIds);

				})
				.catch((err) => {
					reject(err);
				});

			})
			.catch((err) => {
				reject(err);
			});
		});
	}

	/**
	 * Deactivates a Rancher host instance.
	 */
	deactivateHost(hostId) {
		return this._postAction(this.config.rancherUrl + '/hosts/' + hostId, 'deactivate', 'inactive');
	}

	/**
	 * Deletes a rancher host instance.
	 */
	deleteHost(hostId) {
		return this._postAction(this.config.rancherUrl + '/hosts/' + hostId, 'remove', 'removed');
	}

	/**
	 * Generic POST action method. Pass a url and action from
	 * the available actions in the rancher API. Pass an optional
	 * desired state to poll/wait for the state to be reached before
	 * resolving.
	 */
	_postAction(url, action, desiredState) {
		return new Promise((resolve, reject) => {
			request({
				method: 'POST',
				url: url,
				qs: { action: action }
			}, (err, response) => {

				//Reject on error
				if(err) return reject(err);

				let body = JSON.parse(response.body);

				//If we dont have a desired state, resolve immediately
				if(!desiredState) {
					return resolve(body);
				}

				//If we have a desired state, check for immediate match
				else if(desiredState && body.state == desiredState) {
					return resolve(body);
				}

				//Otherwise, poll for the desired state
				else if(desiredState) {
					this._pollState(url, desiredState).then(resolve).catch(reject);
				}

			});
		});
	}

	/**
	 * Polls the specified url for the specified state.
	 */
	_pollState(url, desiredState) {
		const pollWait  = 1000;
		const pollLimit = 10;
		return new Promise((resolve, reject) => {
			let pollCount = 0;
			let poll = setInterval(() => {

				//Stop polling if we hit the limit
				if(pollCount == pollLimit) {
					clearInterval(poll);
					return reject('Timeout waiting for desiredState: ' + desiredState);
				}

				else pollCount++;

				console.log('Poll: ' + pollCount);

				//Make a request for the desired state
				request({
					method: 'GET',
					url: url
				}, (err, response) => {

					//If there was an error, clear the interval and reject
					if(err) {
						clearInterval(poll);
						return reject('Error checking for desired state: ' + desiredState);
					}

					//Check if the current state matches the desired state
					if(JSON.parse(response.body).state == desiredState) {

						//Reached desired state, clear the interval and resolve
						clearInterval(poll);
						return resolve('DONE');

					}

				});

			}, pollWait);
		});
	}

}

export default Rancher;
