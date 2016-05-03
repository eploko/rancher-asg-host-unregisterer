
module.exports = function(req, res, sns) {

	console.log('=> Received subscription confirmation request.')

	//Check required body params
	if( !req.body.Token ||
		!req.body.TopicArn ) {
		console.log('   Error: missing token or ARN');
		return res.status(400).json('Missing token or ARN');
	}

	console.log('   Attemping confirmation:');
	console.log('   - TopicArn: ' + req.body.TopicArn);
	console.log('   - Token: ' + req.body.Token);

	//All good, make the confirm request
	sns.confirmSubscription({
		Token: req.body.Token,
		TopicArn: req.body.TopicArn
	}, function(err, data) {

		//Handle error
		if(err) {
			console.log('   Error:');
			console.log(err);
			return res.status(400).json(err);
		}

		//All good
		console.log('   Success!');
		return res.status(200).json('ok');

	});

};
