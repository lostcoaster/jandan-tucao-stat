// ==UserScript==
// @name         Jandan Tucao Stat
// @namespace    http://github.com/lostcoaster/
// @version      0.3.1
// @description  Augment jandan tucao system
// @author       lc
// @match        http://jandan.net/pic*
// @match        http://jandan.net/duan*
// @grant        none
// @updateURL    https://github.com/lostcoaster/jandan-tucao-stat/raw/master/jandan-tucao-stat.user.js
// ==/UserScript==

$(function() {
    'use strict';
    var maxSpan = 72 * 3600 * 1000; // 72 hours
    var maxInactive = 12 * 3600 * 1000; // 12 hours
    var maxReq = 20;
    var scanInterval = 60 * 1000; // 1min
    var runTest = true;

    function assert_find(jq_item, exp, num){
        // sanity check
        var ret = jq_item.find(exp);
        if(!ret.length || (num!==undefined && ret.length!=num)){
            throw new Error('"' + exp + '" failed to match, probably indicating a website structure change.');
        }
        return ret;
    }
    function sequential(func, array){
        // util to do sequential async
        function callNext(i){
            return new Promise(function(resolve){
                func(array[i]).then(()=>{resolve(i+1);});
            });
        }
        var pro = Promise.resolve(0);
        for(var i = 0 ; i < array.length; ++i){
            pro = pro.then(callNext);
        }
        return pro;
    }
    var memo = {
        name:"tustat_history",
        storage:{
            history:{},
            active:{},
            unread: [],
            last_scan: 0,
            version: 1,
        },
        load: function(){
            var v = localStorage.getItem(this.name);
            if (v){
                this.storage = JSON.parse(v);
            }
            this.upgrade_store();
        },
        save: function(){
            localStorage.setItem(this.name, JSON.stringify(this.storage));
        },
        upgrade_store: function(){
            // allows upgrade from old style storage to newer version
            // currently nothing
            this.save();
        },
        add: function(form){
            var tid = assert_find(form, 'button').data('id');
            var nick = assert_find(form, '.tucao-nickname').val();
            var page = Number(assert_find($('body'), '.current-comment-page:eq(0)', 1).text().replace(/[\[\]]/g,''));
            if(this.storage.active.hasOwnProperty(tid)){
                this.storage.active[tid].expire = Date.now() + maxSpan;
            } else {
                this.storage.active[tid] = {
                    expire: Date.now() + maxSpan,
                    nick: nick,
                    last_update: Date.now(),
                    page: page,
                    path: location.href.match(/(^.*\/(duan|pic)).*/)[1],
                };
            }
            this.save();
        },
        handle: function(new_form){
            // adds handle to appeared forms
            var mThis = this;
            assert_find(new_form, 'button').click(function(){mThis.add(new_form);});
            assert_find(new_form, '.tucao-content').keydown(function(ev){if(ev.ctrlKey && ev.keyCode==13) mThis.add(new_form);});
        },
        deactivate: function(tid){
            this.storage.history[tid] = {};
            delete this.storage.active[tid];
            this.save();
        },
        scan: function(){
            // rules
            // 1. only 1 request at a time.
            // 2. to a maximum of 20 requests.
            // 3. any tucao that were not updated in last 12 hrs are removed from future scanning.
            // 4. any tucao that are at least 72 hrs old are removed from future scanning.
            // 5. at most 1 scan per minute
            if(this.storage.last_scan + scanInterval > Date.now()){
                console.log('Jandan Tucao Stat: Ignored too frequent scanning');
                return;
            }
            this.storage.last_scan = Date.now();
            this.save();
            var list = [];
            var now = Date.now();
            for(var k in this.storage.active){
                if(!this.storage.active.hasOwnProperty(k)){
                    continue;
                }
                if(this.storage.unread.indexOf(k) >= 0){
                    continue; // we are not removing an unread but inactive one
                }
                if(this.storage.active[k].expire <= now){
                    this.deactivate(k);
                    continue;
                }
                list.push(k);
                if(list.length >= maxReq){
                    break;
                }
            }
            // sequential request
            var mThis = this;
            function request(tid){
                return $.get('http://jandan.net/tucao/'+tid).then(function(data){
                    mThis.process(data);
                });
            }
            sequential(request, list);
        },
        process: function(data){
            var comments = data.tucao;
            if(comments.length === 0) return;
            var tid = comments[0].comment_post_ID;
            var info = this.storage.active[tid];
            info.last_update = info.last_update || 0;
            var reg = new RegExp('<a href="#tucao-\\d+" class="tucao-link">@'+info.nick+'</a>');
            for(var i = 0; i < comments.length; ++i){
                if(comments[i].comment_date_int <= info.last_update){
                    continue;
                }
                if(comments[i].comment_content.search(reg) >= 0){
                    this.storage.unread.push(tid);
                    break;
                }
            }
            info.last_update = comments[comments.length-1].comment_date_int;
            this.save();
            if(info.last_update * 1000 + maxInactive < Date.now()){
                // remove inactive entries
                this.deactivate(tid);
            }
            this.disp_brief();
        },
        disp_detail: function(){
            if (this.storage.unread.length == 0){
                return;
            }
            detailElem.height(this.storage.unread.length * 30 - 5);
            detailElem.empty();
            for (var i = 0; i<this.storage.unread.length; ++i){
                var tid = this.storage.unread[i];
                var item = this.storage.active[tid];
                var en = $('<div class="tustat-unread"> <a href="' + 
                           item.path + '/page-'+ item.page +'#comment-' + tid +
                           '" target="_new"> #'+ tid +' </a> </div>'); // item.page still undone
                en.css({
                    margin: '5px auto',
                    height: '20px',
                });
                detailElem.append(en);
            }
            detailElem.show();
            this.storage.unread = [];
            this.save();
        },
        disp_brief: function(){
            if(this.storage.unread.length > 0){
                notiElem.show();
                notiElem.text('目前有'+this.storage.unread.length+'条回复');
            } else {
                notiElem.hide();
            }
        }
    };

    var quotation = {
        elem: $('<div class="tustat-quote" style="position:fixed;border: 2px solid darkorange;border-radius: 10px;"/>'),
        show: function(cid, x, y){
            var text = $('a[name="'+cid+'"]').parents('.tucao-row').find('.tucao-content').text();
            this.elem.text(text);
            this.elem.css({
                left: x+'px',
                top: y+'px',
            });
            $('body').append(this.elem);
        },
        hide: function(){$('.tustat-quote').remove();},
    };

    function handleNewForm(ev){
        var tar = $(ev.target);
        if(tar.hasClass('tucao-form'))memo.handle(tar);
        tar.find('.tucao-link').mouseenter(function(ev){
            var url = ev.target.href;
            quotation.show(url.substr(url.lastIndexOf('#')+1), ev.clientX, ev.clientY);
        }).mouseout(function(ev){
            quotation.hide();
        });
    }

    var notiElem = $('<div class="tustat-note" style="cursor: pointer; border: 2px solid darkorange;border-radius: 10px;position:fixed;right: 50px;bottom: 20px;width: 130px;height: 20px;box-shadow: 0px 0px 4px 1px darkorange;"/>');
    notiElem.click(function(){if(detailElem.is(':visible'))detailElem.hide();else memo.disp_detail();});
    $('body').append(notiElem);
    var detailElem = $('<div class="tustat-detail" style="border: 2px solid darkorange;border-radius: 10px;position:fixed;right: 50px;bottom: 50px;width: 130px;height: 320px;box-shadow: 0px 0px 4px 1px darkorange;"/>');
    $('body').append(detailElem);
    detailElem.hide();
    $('li').on('DOMNodeInserted', handleNewForm);
    memo.load();
    memo.scan();
    memo.disp_brief();

    if(runTest){
        window.tustat_memo = memo;
    }
});
