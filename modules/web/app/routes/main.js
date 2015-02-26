define(["tinybone/backadapter", "safe","lodash"], function (api,safe,_) {
	return {
		index:function (req, res, cb) {
			var token = req.cookies.token || "public"
			safe.parallel({
				view:function (cb) {
					requirejs(["views/index_view"], function (view) {
						safe.back(cb, null, view)
					},cb)
				},
				data: function (cb) {

					api("assets.getProjects",token, {_t_age:"30d"}, safe.sure(cb, function (project) {
						var quant = 1; var period = 15;
						var dtend = new Date();
						var dtstart = new Date(dtend.valueOf() - period * 60 * 1000);
						safe.forEach(project, function (n, cb) {
							api("collect.getPageViews", token, {
								_t_age: quant + "m", quant: quant, filter: {
									_idp: n._id,
									_dt: {$gt: dtstart,$lte:dtend}
								}
							}, safe.sure(cb, function (v) {
								var vall = null; var vale = null; var valr = null;
								if (v.length) {
									vall = vale = valr = 0;
									_.each(v, function (v) {
										valr+=v.value?v.value.r:0;
										vall+=v.value?(v.value.tt/1000):0;
										vale+=100*(v.value?(1.0*v.value.e/v.value.r):0);
									})

									vall=(vall/period).toFixed(2);
									vale=(vale/period).toFixed(2);
									valr=(valr/period).toFixed(2);
								}

								cb(null,_.extend(n, {views: valr, errors: vale, etu: vall}))
							}))
						}, safe.sure(cb, function() {
							cb(null, project)
						}))
					}))
				}
			}, safe.sure(cb, function (r) {
				res.renderX({
					route:req.route.path,
					view:r.view,
					data:{
						projects:r.data,
						title:"Tinelic - Home"
					}})
			}))
		},
		event:function (req, res, next) {
			var token = req.cookies.token || "public"
			safe.parallel({
				view:function (cb) {
					requirejs(["views/event_view"], function (view) {
						safe.back(cb, null, view)
					},cb)
				},
				event:function (cb) {
					api("collect.getEvent",token, {_t_age:"30d",_id:req.params.id}, cb)
				},
				info:function (cb) {
					api("collect.getEventInfo",token, {_t_age:"10m",filter:{_id:req.params.id}}, cb)
				}
			}, safe.sure( next, function (r) {
				res.renderX({view:r.view,route:req.route.path,data:{event:r.event,info:r.info,title:"Event "+r.event.message}})
			}))
		},
		page:function (req, res, cb) {
			requirejs(["views/page_view"], safe.trap(cb, function (view) {
				res.renderX({view:view,route:req.route.path,data:{title:"Page Page"}})
			}), cb);
		},
		users:function (req, res, cb) {
			var token = req.cookies.token || "public"
			safe.parallel({
				view: function (cb) {
					requirejs(["views/users_view"], function (view) {
						safe.back(cb, null, view)
					}, cb)
				},
				users: function (cb) {
					api("users.getUsers", token, {}, cb)
				}
			},safe.sure(cb, function(r) {
				res.renderX({view: r.view, route:req.route.path, data: {title: "Manage users", users: r.users}})

			}))
		},
		project:function (req, res, cb) {
			var token = req.cookies.token || "public"
			var str = req.query._str || req.cookies.str || '1d';
			var quant = 10;
			var range = 60 * 60 * 1000;

			// transcode range paramater into seconds
			var match = str.match(/(\d+)(.)/);
			var units = {
				h:60 * 60 * 1000,
				d:24 * 60 * 60 * 1000,
				w:7 * 24 * 60 * 60 * 1000
			}
			if (match.length==3 && units[match[2]])
				range = match[1]*units[match[2]];

			var dtstart = new Date(Date.parse(Date()) - range);
			var dtend = Date();

			safe.parallel({
				view:function (cb) {
					requirejs(["views/project/project_view"], function (view) {
						safe.back(cb, null, view)
					},cb)
				},
				data:function (cb) {
					api("assets.getProject",token, {_t_age:"30d",filter:{slug:req.params.slug}}, safe.sure( cb, function (project) {
						safe.parallel({
							views: function (cb) {
								api("collect.getPageViews",token,{_t_age:quant+"m",quant:quant,filter:{
									_idp:project._id,
									_dt: {$gt: dtstart,$lte:dtend}
								}}, cb);
							},
							errors: function (cb) {
								api("collect.getErrorStats",token,{_t_age:quant+"m",filter:{
									_idp:project._id,
									_dt: {$gt: dtstart,$lte:dtend}
								}}, cb);
							},
							ajax: function (cb) {
								api("collect.getAjaxStats",token,{_t_age:quant+"m",quant:quant,filter:{
									_idp:project._id,
									_dt: {$gt: dtstart,$lte:dtend}
								}}, cb);
							},
							actions: function (cb) {
								api("collect.getActions", token, {_t_age:quant+"m",quant:quant,filter:{
									_idp:project._id,
									_dt: {$gt: dtstart,$lte:dtend}}}, cb)
							},
							topAjax: function (cb) {
								api("collect.getTopAjax", token, {
									_t_age:quant+"m",
									quant:quant,
									filter:{
										_idp:project._id,
										_dt: {$gt: dtstart,$lte:dtend}
									}
								}, cb)
							},
							topPages: function (cb) {
								api("collect.getTopPages", token, {
									_t_age:quant+"m",
									quant:quant,
									filter:{
										_idp:project._id,
										_dt: {$gt: dtstart,$lte:dtend}
									}
								}, cb)
							},
							topTransactions: function(cb) {
								api("collect.getTopTransactions", token, {
									_t_age:quant+"m",
									quant:quant,
									filter:{
										_idp:project._id,
										_dt: {$gt: dtstart,$lte:dtend}
									}
								}, cb)
							}
						}, safe.sure(cb, function (r) {
							 cb(null,_.extend(r, {project:project, filter: str}))
						}))
					}))
				}
			}, safe.sure(cb, function (r) {
				var views = {}; // total | server | browser | transaction | page | ajax
				var valtt; var vale; var valr; var period;
				if (r.data.views.length != 0) {
					valtt = vale = valr = 0;
					period = r.data.views.length;
					_.forEach(r.data.views, function (v) {
						valr+=v.value?v.value.r:0;
						valtt+=v.value?(v.value.tt/1000):0;
						vale+=v.value?v.value.e:0;
					})

					valtt=(valtt/period).toFixed(2);
					vale=(vale/period).toFixed(2);
					valr=(valr/period).toFixed(2);
					views.total = {rpm: valr, errorpage: vale, etupage: valtt}

				}
				if (r.data.actions.length != 0) {
					valtt = vale = valr = 0;
					period = r.data.actions.length;
					_.forEach(r.data.actions, function (v) {
						valr+=v.value?v.value.r:0;
						valtt+=v.value?(v.value.tt):0;
					})

					valtt=(valtt/period).toFixed(2);
					valr=(valr/period).toFixed(2);
					_.extend(views.total,{rsm: valr, ttserver: valtt});

				}
				if (r.data.ajax.length != 0) {
					valtt = vale = valr = 0;
					period = r.data.ajax.length;
					_.forEach(r.data.ajax, function (v) {
						valr+=v.value?v.value.r:0;
						valtt+=v.value?(v.value.tt/1000):0;
						vale+=v.value?v.value.e:0;
					})

					valtt=(valtt/period).toFixed(2);
					vale=(vale/period).toFixed(2);
					valr=(valr/period).toFixed(2);
					_.extend(views.total,{ram: valr, errorajax: vale, etuajax: valtt})

				}
				if (r.data.errors.length != 0) {
					views.browser = {};

					var data = _.take(r.data.errors, 10)
					views.browser.err = data;
				}
				if (r.data.topAjax.length != 0) {
					views.topa = {}
					views.topa.a = _.take(_.sortBy(r.data.topAjax, function(r) {
						return r.value.tt
					}).reverse(),10)
					var progress = null;
					_.forEach(views.topa.a,function(r) {
						if (!progress) {
							progress = r.value.tt
						}
						else {
							progress += r.value.tt
						}
					})
					_.forEach(views.topa.a, function(r) {
						r.value.progress = (r.value.tt/progress)*100
						var split = r._id.split('/')
						if (split.length > 3)
							r._id = '../'+split[split.length-1];
					})
				}
				if (r.data.topPages.length != 0) {
					views.topp = {}
					views.topp.p = _.take(_.sortBy(r.data.topPages,function(r) {
						return r.value.tt
					}).reverse(),10)
					var progress = null;
					_.forEach(views.topp.p,function(r) {
						if (!progress) {
							progress = r.value.tt
						}
						else {
							progress += r.value.tt
						}
					})
					_.forEach(views.topp.p, function(r) {
						r.value.progress = (r.value.tt/progress)*100
						var split = r._id.split('/')
						if (split.length > 3)
							r._id = '../'+split[split.length-1]
					})
				}
				if (r.data.topTransactions.length != 0) {
					views.transactions = {}
					views.transactions.top = _.take(_.sortBy(r.data.topTransactions, function(r) {
						return r.value.tt
					}).reverse(),10)
					var progress = null;
					_.forEach(views.transactions.top,function(r) {
						if (!progress) {
							progress = r.value.tt
						}
						else {
							progress += r.value.tt
						}
					})
					_.forEach(views.transactions.top, function(r) {
						r.value.progress = (r.value.tt/progress)*100
						var split = r._id.split('/')
						if (split.length > 3)
							r._id = '../'+split[split.length - 2]+'/'+split[split.length-1]
					})
				}

				res.renderX({view:r.view,route:req.route.path,data:_.extend(r.data,{quant:quant,title:"Project "+r.data.project.name, stats: views})})
			}))
		}
	}
})
