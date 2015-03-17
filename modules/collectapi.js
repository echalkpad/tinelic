"use strict";
var _ = require("lodash");
var safe = require("safe");
var mongo = require("mongodb");
var crypto = require('crypto');
var moment = require("moment");
var useragent = require("useragent");
var geoip = require('geoip-lite');
var request = require('request');
var zlib = require('zlib');
var ErrorParser_GetsentryServer = require("./error_parser/parser_getsentry_server.js");
var ErrorParser_Newrelic = require( "./error_parser/parser_newrelic.js" );

var buf = new Buffer(35);
buf.write("R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=", "base64");

module.exports.deps = ['mongo','prefixify','validate','assets'];

module.exports.init = function (ctx, cb) {
	var prefixify = ctx.api.prefixify.datafix;
	var queryfix = ctx.api.prefixify.queryfix;
	ctx.api.validate.register("error", {$set:{properties:{
		_dt:{type:"date",required:true},
		_idp:{type:"mongoId",required:true},
		_id:{type:"mongoId"}
	}}})
	ctx.api.mongo.getDb({}, safe.sure(cb, function (db) {
		safe.parallel([
			function (cb) {
				db.collection("page_errors",safe.sure(cb, function (col) {
					safe.parallel([
						function (cb) { col.ensureIndex({_dt:1}, cb) },
						function (cb) { col.ensureIndex({chash:1}, cb) },
						function (cb) { col.ensureIndex({_idp:1}, cb) },
						function (cb) { col.ensureIndex({_idpv:1}, cb) },
						function (cb) { col.ensureIndex({message:1}, cb) }
					], safe.sure(cb, col))
				}))
			},
			function (cb) {
				db.collection("pages",safe.sure(cb, function (col) {
					safe.parallel([
						function (cb) { col.ensureIndex({_dt:1}, cb) },
						function (cb) { col.ensureIndex({chash:1}, cb) },
						function (cb) { col.ensureIndex({_idp:1}, cb) }
					], safe.sure(cb, col))
				}))
			},
			function (cb) {
				db.collection("page_reqs", safe.sure(cb, function (col) {
					safe.parallel([
						function (cb) { col.ensureIndex({chash:1}, cb)},
						function (cb) { col.ensureIndex({_dt:1}, cb)},
						function (cb) { col.ensureIndex({_idp:1}, cb)}
					], safe.sure(cb, col))
				}))
			},
			function (cb) {
				db.collection("actions", cb)
			},
			function (cb) {
				db.collection("action_stats", cb)
			},
			function (cb) {
				db.collection("action_errors", cb)
			},
			function (cb) {
				db.collection("metrics", cb)
			}
		],safe.sure_spread(cb, function (events,pages,ajax, actions, as, action_errors, metrics) {
			ctx.express.post("/agent_listener/invoke_raw_method", function( req, res, next ) {
				function nrParseTransactionName( value ) {
					var _value_array = value.split( "/" );
					var _type = _value_array.length > 1 ? _value_array[0] + "/" + _value_array[1] : ""
						, _name = "";
					for( var i = 2; i < _value_array.length; i++ )
						_name += (_name.length > 0 ? "/" : "") + _value_array[i];
					return { name: _name.length ? _name : "-unknown-", type: _type.length ? _type : "-unknown-" };
				}
				function nrNonFatal(err) {
					// capture NewRelic errors with GetSentry, cool to be doublec backed up
					if (err) {
						if (ctx.locals && ctx.locals.ravenjs)
							ctx.locals.ravenjs.captureError(err);
						else
							console.log(err);
					}
				}
				safe.run(function (cb) {
					var nrpc = {
						get_redirect_host:function () {
							// agent ask for reporting host, return by ourselves
							var _host_arr = req.headers.host.split( ":" );
							res.json( { return_value: _host_arr[0] } );
						},
						connect:function () {
							// on connect we should link agent with its project id when available
							var body = req.body[0];
							var agent_name = body.app_name[0];
							ctx.api.assets.getProject("public", {name:agent_name}, safe.sure(cb, function (project) {
								if (!project)
									throw new Error( "Project \"" + agent_name + "\" not found" );

								var run = {_idp:project._id, _s_pid:body.pid, _s_logger:body.language, _s_host:body.host};
								res.json({return_value:{"agent_run_id": new Buffer(JSON.stringify(run)).toString('base64')}});
							}))
						},
						agent_settings:function () {
							// seems to be hook to alter agent settings
							// not supported now, just mirror back
							res.json(req.body)
						},
						metric_data:function () {
							var body = req.body;
							var run = prefixify(JSON.parse(new Buffer(req.query.run_id, 'base64').toString('utf8')));

							var _dts = new Date( body[1] * 1000.0 )
								, _dte = new Date( body[2] * 1000.0 )
								, _dt = new Date( (_dts.getTime() + _dte.getTime()) / 2.0 );

							var action_stats = {};
							_.each(body[body.length-1], function (item) {
								// grab memory metrics
								if (item[0].name == "Memory/Physical") {
									metrics.insert({
										_idp: run._idp
										, "_dt": _dt
										, "_dts": _dts
										, "_dte": _dte
										, "_s_type": item[0].name
										, "_s_name": ""
										, "_s_pid": run._s_pid
										, "_s_host": run._s_host
										, _i_cnt: item[1][0]
										, _f_val: item[1][1]
										, _f_own: item[1][2]
										, _f_min: item[1][3]
										, _f_max: item[1][4]
										, _f_sqr: item[1][5]
									}, nrNonFatal)
								}
								// grab transaction segments stats
								var scope = item[0]["scope"];
								if (!scope) return;

								var trnScope = nrParseTransactionName(scope)
								var trnName = nrParseTransactionName(item[0]["name"])

								if( !action_stats[scope] ) {
									action_stats[scope] = {
										"_idp": run._idp
										, "_s_name": trnScope.name
										, "_s_type": trnScope.type
										, "_dt": _dt
										, "_dts": _dts
										, "_dte": _dte
										, data: []
									}
								}
								action_stats[scope].data.push( {
									_s_name: trnName.name,
									_s_type: trnName.type,
									_i_cnt: item[1][0],
									_i_tt: Math.round(item[1][1]*1000),
									_i_own: Math.round(item[1][2]*1000),
									_i_min: Math.round(item[1][3]*1000),
									_i_max: Math.round(item[1][4]*1000),
									_i_sqr: Math.round(item[1][5]*1000)
								})
							})
							if (_.size(action_stats)) {
								as.insert( _.values(action_stats), nrNonFatal)
							}
							res.json( { return_value: "ok" } );
						},
						analytic_event_data:function () {
							var body = req.body;
							var run = prefixify(JSON.parse(new Buffer(req.query.run_id, 'base64').toString('utf8')));

							_.each(body[body.length - 1], function (item) {
								item = item[0];
								var trnName = nrParseTransactionName(item["name"]);
								actions.insert({
									"_idp": run._idp
									, "_s_name": trnName.name
									, "_s_type": trnName.type
									, "_dt": new Date(item["timestamp"] )
									, "_i_wt": Math.round(item["webDuration"]*1000)
									, "_i_tt": Math.round(item["duration"]*1000)
								}, nrNonFatal);
							})
							res.json( { return_value: "ok" } );
						},
						error_data:function () {
							var body = req.body;
							var run = prefixify(JSON.parse(new Buffer(req.query.run_id, 'base64').toString('utf8')));

							var error_parser = new ErrorParser_Newrelic();
							error_parser.add_error(run, body[body.length - 1], safe.sure( nrNonFatal, function( error_data ) {
								action_errors.insert( error_data, nrNonFatal)
							}));
							res.json( { return_value: "ok" } );
						}
					}
					var fn = nrpc[req.query.method];
					if (!fn)
						throw new Error("NewRelic: unknown method " + req.query.method)
					fn();
				}, function (err) {
					nrNonFatal(err)
					res.json({exception:{message:err.message}});
				})
			})
			ctx.router.get("/ajax/:project", function (req, res, next) {
				var data = req.query;
				data._idp = new mongo.ObjectID(req.params.project);
				data._dtr = new Date();
				data._dt = data._dtr;

				var ip = req.headers['x-forwarded-for'] ||
					req.connection.remoteAddress ||
					req.socket.remoteAddress ||
					req.connection.socket.remoteAddress;

				data = prefixify(data,{strict:1});
				var md5sum = crypto.createHash('md5');
				md5sum.update(ip);
				md5sum.update(req.headers['host']);
				md5sum.update(req.headers['user-agent']);
				md5sum.update(""+parseInt((data._dtp.valueOf()/(1000*60*60))))
				data.shash = md5sum.digest('hex');
				md5sum = crypto.createHash('md5');
				md5sum.update(ip);
				md5sum.update(req.headers['host']);
				md5sum.update(req.headers['user-agent']);
				md5sum.update(data._dtp.toString());
				data.chash = md5sum.digest('hex');
				data._s_name = data.r
				data._s_url = data.url
				delete data.url
				delete data.r
				safe.run(function (cb) {
					pages.findAndModify(
						{
							chash: data.chash,
							_dt: {$lte: data._dt}
						}, {_dt: -1},{$inc:{_i_err: (data._code == 200)?0:1}}, {multi: false}, safe.sure(cb, function (page) {
							if (page) {
								data._idpv = page._id;
								(page._s_route) && (data._s_route = page._s_route);
								(page._s_uri) && (data._s_uri = page._s_uri);
							}
							ajax.insert(data, cb)
						}))
				}, function (err) {
					if (err)
						return console.log(err);
					res.set('Content-Type', 'image/gif');
					res.send(buf);
				})
			})
			ctx.router.get("/browser/:project",function (req, res, next) {
				var data = req.query;
				data._idp=req.params.project;
				data._dtr = new Date();
				data._dtc = data._dt;
				data._dt = data._dtr;
				data.agent = useragent.parse(req.headers['user-agent']).toJSON();
				var ip = req.headers['x-forwarded-for'] ||
					 req.connection.remoteAddress ||
					 req.socket.remoteAddress ||
					 req.connection.socket.remoteAddress;

				var geo = geoip.lookup(ip);
				if (geo)
					data.geo = JSON.parse(JSON.stringify(geo));

				data = prefixify(data,{strict:1});
				var md5sum = crypto.createHash('md5');
				md5sum.update(ip);
				md5sum.update(req.headers['host']);
				md5sum.update(req.headers['user-agent']);
				md5sum.update(""+parseInt((data._dtp.valueOf()/(1000*60*60))))
				data.shash = md5sum.digest('hex');
				md5sum = crypto.createHash('md5');
				md5sum.update(ip);
				md5sum.update(req.headers['host']);
				md5sum.update(req.headers['user-agent']);
				md5sum.update(data._dtp.toString());
				data.chash = md5sum.digest('hex');
				data._i_err = 0;
				data._s_uri = data.p
				data._s_route = data.r
				delete data.r
				delete data.p
				safe.run(function (cb) {
					pages.insert(data, safe.sure(cb, function (docs) {
						// once after inserting page we need to link
						// this page events that probably cread earlier
						var _id = docs[0]._id;
						safe.parallel([
							function(cb) {
								events.update({chash: data.chash, _dt:{$gte:new Date(data._dt.valueOf()-data._i_tt*2),$lte:data._dt}}, {
									$set: {
										_idpv: _id,
										request: {
											route: data._s_route,
											uri: data._s_uri
										}
									}
								}, {multi: true}, safe.sure(cb, function (updates) {
									if (updates)
										pages.update({_id: _id}, {$inc: {_i_err: updates}}, cb);
									else
										cb();
								}))
							},
							function(cb) {
								ajax.update({chash: data.chash, _dt:{$gte:new Date(data._dt.valueOf()-data._i_tt*2),$lte:data._dt}}, {
									$set: {
										_idpv: _id,
										_s_route: data._s_route,
										_s_uri: data._s_uri}
								}, {multi: true}, safe.sure(cb, function() {
									ajax.find({chash: data.chash, _code: {$ne: '200'}}).count(safe.sure(cb, function(count) {
										if (count > 0)
											pages.update({_id: _id}, {$inc: {_i_err: count}}, cb);
										else
											cb();
									}))
								}))
							}
						], cb)
					}))
				}, function (err) {
					if (err)
						return console.log(err);
					res.set('Content-Type', 'image/gif');
					res.send(buf);
				})
			})
			// dsn is like http://auth1:auth2@{host}/collect/sentry/{projectid}
			ctx.router.post( "/sentry/api/store", function( req, res, next ) {
				safe.run(function(cb) {
					var zip_buffer = new Buffer( req.body.toString(), 'base64' );
					zlib.inflate( zip_buffer, safe.sure( cb, function( _buffer_getsentry_data ) {
						var getsentry_data = JSON.parse( _buffer_getsentry_data.toString() );
						var error_parser = new ErrorParser_GetsentryServer();
						error_parser.add_error( db, new mongo.ObjectID(getsentry_data.project.toString()),
							getsentry_data, safe.sure( cb, function( error_data ) {
								action_errors.insert( error_data, cb)
							})
						);
					}));
				}, function( error ){
					if (error) {
						// report getsentry error with newrelic ;)
						newrelic.noticeError(error);
						res.writeHead( 500, { 'x-sentry-error': error.toString() } );
						res.status(500).end( error.toString() );
					} else {
						res.status(200).end( "ok" );
					}
				});
			})
			ctx.router.get("/sentry/api/:project/:action",function (req, res, next) {
				var ip = req.headers['x-forwarded-for'] ||
					 req.connection.remoteAddress ||
					 req.socket.remoteAddress ||
					 req.connection.socket.remoteAddress;

				var data = JSON.parse(req.query.sentry_data);
				var _dtp = data._dtp || data._dtInit;
				data.project && (delete data.project);
				data._idp = req.params.project;
				data._dtr = new Date();
				data._dtc = data._dt;
				data._dt = data._dtr;
				data._dtp = _dtp;
				data._dtInit && (delete data._dtInit);
				data.agent = useragent.parse(req.headers['user-agent'],data.request.headers['User-Agent']).toJSON();
				data = prefixify(data,{strict:1});
				var md5sum = crypto.createHash('md5');
				md5sum.update(ip);
				md5sum.update(req.headers['host']);
				md5sum.update(req.headers['user-agent']);
				md5sum.update(""+(parseInt(data._dtp.valueOf()/(1000*60*60))))
				data.shash = md5sum.digest('hex');
				md5sum = crypto.createHash('md5');
				md5sum.update(ip);
				md5sum.update(req.headers['host']);
				md5sum.update(req.headers['user-agent']);
				md5sum.update(data._dtp.toString());
				data.chash = md5sum.digest('hex');
				// when error happens try to link it with current page
				// which is latest page from same client (chash)
				// which is registered not later than current event
				data._s_culprit = data.culprit; delete data.culprit;
				data._s_message = data.message; delete data.message;
				data._s_id = data.event_id; delete data.event_id;
				data._s_logger = data.logger; delete data.logger;
				data.exception._s_type = data.exception.type; delete data.exception.type;
				data.exception._s_value = data.exception.value; delete data.exception.value;
				_.forEach(data.stacktrace.frames, function(r) {
					r._s_file = r.filename; delete r.filename;
					r._i_line = r.lineno; delete r.lineno;
					r._i_col = r.colno; delete r.colno;
					r._s_func = r.function; delete r.function;
					r._b_inapp = r.in_app; delete r.in_app;
				})
				delete data.platform;

				safe.run(function (cb) {
					pages.findAndModify({chash:data.chash, _dt:{$lte:data._dt}},{_dt:-1},{$inc:{_i_err:1}},{multi:false}, safe.sure(cb, function (page) {
						if (page) {
							data._idpv = page._id;
							(page._s_route) && (data.request.route = page._s_route);
							(page._s_uri) && (data.request.uri = page._s_uri);
						}
						events.insert(data, cb)
					}))
				}, function (err) {
					if (err)
						return console.log(err);
					res.set('Content-Type', 'image/gif');
					res.send(buf);
				})
			})
		}))
	}),cb(null, {api:{}}))
}
