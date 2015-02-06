require('newrelic')
var tinyback = require('tinyback');
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var _ = require("lodash");

var cfg = {
	modules:[
		{name:"prefixify",object:tinyback.prefixify()},
		{name:"mongo",object:tinyback.mongodb()},
		{name:"users",require:"./modules/usersapi.js"},
		{name:"restapi",object:tinyback.restapi()},
		{name:"assets",require:"./modules/assetsapi.js"},
		{name:"collect",require:"./modules/collectapi.js"},
		{name:"web",require:"./modules/web"}
	],
	config:require("./config.js").config
}

var lcfgPath = "./local-config.js";
if(fs.existsSync(lcfgPath)){
	cfg.config = _.merge(cfg.config,require(lcfgPath).config);
}

tinyback.createApp(cfg, function (err, app) {

	if (err) {
		console.log(err.stack);
		process.exit(0);
	}
	try {
		var options = {
			key: fs.readFileSync(path.resolve(__dirname + '/privatekey.pem'), 'utf8'),
			cert: fs.readFileSync(path.resolve(__dirname + '/certificate.pem'), 'utf8'),
			ssl: true,
			plain: false
		}

		var httpsServer = https.createServer(options, app.express);

		httpsServer.listen(443)
	} catch (e) {};

	var httpServer = http.createServer(app.express);

	httpServer.listen(80);
})
