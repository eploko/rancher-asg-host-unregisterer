var aws     = require('aws-sdk');
var async   = require('async');
var request = require('request');

//Utils
var asyncRequest = require('../util/asyncRequest');

//Setup AWS services
var autoscaling = new aws.AutoScaling({ apiVersion: '2011-01-01', region: 'eu-west-1' });
var ec2         = new aws.EC2        ({ apiVersion: '2015-10-01', region: 'eu-west-1' });

module.exports = function(req, res, config) {

	/**
	 * Takes and instance id and returns a formatted hostname.
	 */
	var getInstanceHostname = function(instanceId, cb){
		console.log('=> Getting instance hostname: ' + instanceId);
		ec2.describeInstances({ InstanceIds: [ instanceId ] }, function(err, instance){

			//Handle errors
			if(err) {
				console.log('   Error: could not get instance hostname.');
				console.log(err);
				return cb(err);
			}
			if(!instance.Reservations || instance.Reservations.length == 0 || !instance.Reservations[0].Instances[0].PrivateIpAddress) {
				return cb('Error: could not get instance hostname. Instance doesn\'t exist?');
			}

			var hostname = 'ip-' + instance.Reservations[0].Instances[0].PrivateIpAddress.replace(/\./g, '-');
			console.log('   - Instance hostname: ' + hostname);

			//Parse the private ip into the hostname pattern and return
			cb(null, hostname);

		});
	}

	/**
	 * Returns a list of project ids registered with the server.
	 */
	var getServerProjectIds = function(cb) {
		request({
			method: 'GET',
			url: config.rancherUrl + '/projects'
		}, function(err, response) {

			//Handle errors
			if(err) {
				return cb(err);
			}

			//Return the project ids
			var projectIds = [];
			var projects = JSON.parse(response.body).data;

			if(!projects || projects.length == 0){
				cb('   Error: no projects found on the rancher server.');
			}

			projects.forEach(function(project) {
				projectIds.push(project.id);
			});

			cb(null, projectIds);

		});
	}

	/**
	 * Returns the id of the host from the rancher server
	 */
	var getHostId = function(hostname, cb) {
		
		console.log('=> Getting host id (' + hostname + ')');

		//First, get the list of registered projects
		getServerProjectIds(function(err, projectIds) {

			//Handle errors
			if(err) {
				return cb(err);
			}

			//If there are no projects, we cant do anything
			if(projectIds.length == 0) {
				return cb('   Error: no projects registered with the server.');
			}

			async.map(projectIds, function(projectId, iteratorCb){

				//Attempt to find the host in the current project
				request({
					method: 'GET',
					url: config.rancherUrl + '/projects/' + projectId + '/hosts?name=' + hostname
				}, function(err, response){

					//Handle errors
					if(err) {
						console.log('   Error checking project (' + projectId + ') for hostname (' + hostname + ')');
						return iteratorCb(err);
					}

					//Parse the body
					var body = JSON.parse(response.body).data;

					//If the host was found, pass the host id back to the iterator
					//callback. If not, pass null.
					if(body.length > 0 && body[0].id){
						iteratorCb(null, body[0].id);
					}

					else {
						iteratorCb(null, null);
					}

				});

			},

			//Once all projects have been checked, or there is an error, this will be called
			function(err, results){

				//Handle errors
				if(err) {
					console.log('   Could not find host id from projects.');
					return cb(err);
				}

				//Check if a host id exists in the results
				var hostId = null;
				results.forEach(function(result) {
					if(result) {
						hostId = result;
					}
				});

				//No host id
				if(!hostId) {
					return cb('   Could not find host id from projects.');
				}

				//Found a host id!
				console.log('   - Found registered host id: ' + hostId);
				cb(null, hostId);

			});

		});
		
	}

	/**
	 * Deactivates the target host. Required before we can delete.
	 */
	var deactivateHost = function(hostId, cb) {

		console.log('=> Deactivating host: ' + hostId);

		asyncRequest({
			method: 'POST',
			url: config.rancherUrl + '/hosts/' + hostId,
			qs: {
				action: 'deactivate'
			}
		}, 'inactive', function(err, response){

			//Handle errors
			if(err) {
				return cb(err);
			}

			//Return the host id
			cb(null, hostId);

		});

	};

	/**
	 * Deletes the host.
	 */
	var deleteHost = function(hostId, cb) {

		console.log('=> Deleting host: ' + hostId);

		asyncRequest({
			method: 'POST',
			url: config.rancherUrl + '/hosts/' + hostId,
			qs: {
				action: 'remove'
			}
		}, 'removed', function(err, response){

			//Handle errors
			if(err) {
				return cb(err);
			}

			//Return the host id
			cb(null, hostId);

		});

	};

	return (function(req, res) {
	
		console.log('=> Received autoscaling lifecycle hook.');

	    //Check required params
	    if( !req.body.Message ) {
	    	console.log('   Error: missing message details.');
	        return res.status(400).json('Missing required params');
	    }

	    //Parse message json
	    var message = JSON.parse(req.body.Message);

	    //Check message
	    if( !message.AutoScalingGroupName ||
	    	!message.LifecycleActionToken ||
	    	!message.LifecycleTransition ||
	    	!message.LifecycleHookName ||
	        !message.EC2InstanceId ||
	        !message.LifecycleActionToken
	        ) {
	    	console.log('   Error: missing required params.');
			return res.status(400).json('Missing required params');
	    }

	    console.log('   Message:');
	    console.log(message);

	    //Only handle terminating state
	    if(message.LifecycleTransition != 'autoscaling:EC2_INSTANCE_TERMINATING') {
	    	console.log('   Incorrect transition event, should be: autoscaling:EC2_INSTANCE_TERMINATING. Got: ' + req.body.Message.LifecycleTransition);
	        return res.status(400).json('Incorrect transition event, should be: autoscaling:EC2_INSTANCE_TERMINATING. Got: ' + req.body.Message.LifecycleTransition);
	    }

	    //Run the sequence of actions
		async.waterfall([
			function(cb) {
				getInstanceHostname(message.EC2InstanceId, cb);
			},
			getHostId,
			deactivateHost,
			deleteHost
		], function(err, finalResult) {

			//Handle any error
			if(err) {
				console.log('   Error: ' + err);
				return res.status(400).json(err);
			}

			//If we get here, everything worked and the instance was removed!
			//Now we just need to complete the lifecycle event..
			var params = {
				AutoScalingGroupName:  message.AutoScalingGroupName,
				LifecycleActionToken:  message.LifecycleActionToken,
				LifecycleHookName:     message.LifecycleHookName,
				LifecycleActionResult: 'CONTINUE'
			};
			autoscaling.completeLifecycleAction(params, function(err, data) {

				if(err) {
					return res.status(400).json(err);
				}

				//All done!
				return res.status(200).json({ msg: 'Host removed!' });

			});

		});
		
	})(req, res);

};
