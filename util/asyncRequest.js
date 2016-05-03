var request = require('request');

/**
 * Helper to request then poll the rancher server for
 * the desired state. Rancher API is async so we need
 * make the initial request then query for results.
 */
module.exports = function(params, desiredState, cb) {

	var pollLimit = 10;
	var pollCount = 0;
	var pollWait = 500;

	console.log('   - Starting async request..');

	request(params, function(err, response) {
		if(err) {
			console.log('==> Error');
			console.log(err);
			return cb(err);
		}

		console.log('   - Initial return state: ' + JSON.parse(response.body).state);

		//Immediate return if the state matches the desired
		if(JSON.parse(response.body).state == desiredState) {
			return cb(null, response.body);
		}

		//Otherwise, poll until completion
		var poll = setInterval(function() {

			console.log('   - Polling for desired state (' + desiredState + ')');

			pollCount++;

			//Check if the maximum polls have been reached
			if(pollCount == pollLimit) {
				return cb('Max tries reached for server response.');
			}

			//Make the poll request
			request({
				method: 'GET',
				url: params.url
			}, function(err, pollResponse){
				
				if(err) {
					clearInterval(poll);
					return cb(err);
				}

				var body = JSON.parse(pollResponse.body);
				var state = body.state;

				console.log('     ...Got state: ' + state);

				//Check if the state matches the desired state
				if(state == desiredState) {
					console.log('     ...State reached, done polling.');
					clearInterval(poll);
					cb(null, body);
				}

			});

		}, pollWait);

	});

};
