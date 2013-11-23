/*
 * Copyright 2013 Jive Software
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

var q = require('q');
var jive = require('../../api');

function Scheduler() {
}

module.exports = Scheduler;

var tasks = {};

var eventHandlerMap = {};

Scheduler.prototype.init = function init( _eventHandlerMap, options ) {
    eventHandlerMap = _eventHandlerMap || jive.events.eventHandlerMap;

    // setup listeners
    jive.events.globalEvents.forEach( function(event) {
        var handlers = eventHandlerMap[event];

        if ( handlers ) {
            if ( typeof handlers === 'function' ) {
                // normalize single handler into an array
                handlers = [ handlers ];
            }

            handlers.forEach( function( handler ) {
                jive.events.addLocalEventListener( event, handler );
            });
        }

    });
};

/**
 * Schedule a task.
 * @param eventID which event to fire
 * @param context what to pass to the event
 * @param interval The interval to invoke the callback
 */
Scheduler.prototype.schedule = function schedule(eventID, context, interval, delay) {
    eventID = eventID || jive.util.guid();

    context = context || {};
    var deferred = q.defer();
    var handlers;
    if (context['eventListener']) {
        if ( eventHandlerMap[context['eventListener']] ) {
            handlers = eventHandlerMap[context['eventListener']][eventID];
        }
    } else {
        handlers = eventHandlerMap[eventID];
    }

    handlers = handlers || [];

    var next = function(timer, eventID) {
        var promises = [];
        handlers.forEach( function(handler) {
            var p = handler(context);
            if ( p && p['then'] ) {
                promises.push(p);
            }
        });

        q.all( promises).then(
            // success
            function(result ) {
                result = result['forEach'] && result.length == 1 ? result[0] : result;
                // nuke self, if no longer scheduled
                if ( timer && eventID && !tasks[eventID] ) {
                    clearInterval(timer);
                }
                deferred.resolve(result);
            },

            // fail
            function(e) {
                if ( timer && eventID && !tasks[eventID] ) {
                    clearInterval(timer);
                }
                deferred.reject(e);
            }
        );
    };

    if (interval) {
        setTimeout( function() {
            var timer = tasks[eventID] = setInterval(function() {
                next(timer, eventID);
            }, interval);
        }, delay || 1 );
    }
    else {
        setTimeout( function() {
            next();
        }, delay || 1);
    }
    jive.logger.debug("Scheduled task: " + eventID, interval || "immediate");

    return deferred.promise;
};

Scheduler.prototype.unschedule = function unschedule(eventID){
    clearInterval(tasks[eventID]);
    delete tasks[eventID];
};

Scheduler.prototype.getTasks = function getTasks(){
    return Object.keys(tasks);
};

Scheduler.prototype.isScheduled = function( eventID ) {
    var deferred = q.defer();
    if (tasks[eventID]) {
        deferred.resolve(true);
    } else {
        deferred.resolve(false);
    }

    return deferred.promise;
};

Scheduler.prototype.shutdown = function(){
    var scheduler = this;
    eventHandlerMap = {};
    this.getTasks().forEach(function(taskKey){
        scheduler.unschedule(taskKey);
    });

    return q.resolve();
};