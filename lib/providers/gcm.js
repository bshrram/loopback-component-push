// Copyright IBM Corp. 2013,2018. All Rights Reserved.
// Node module: loopback-component-push
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const g = require('strong-globalize')();

const inherits = require('util').inherits;
const extend = require('util')._extend;
const EventEmitter = require('events').EventEmitter;
const gcm = require('node-gcm');
const debug = require('debug')('loopback:component:push:provider:gcm');

function GcmProvider(pushSettings) {
  const settings = pushSettings.gcm || {};
  this._setupPushConnection(settings);
}

inherits(GcmProvider, EventEmitter);

exports = module.exports = GcmProvider;

GcmProvider.prototype._setupPushConnection = function(options) {
  debug('Using GCM Server API key %j', options.serverApiKey);
  this._connection = new gcm.Sender(options.serverApiKey);
};

GcmProvider.prototype.pushNotification = function(notification, deviceToken) {
  const self = this;

  const registrationIds = (typeof deviceToken == 'string') ?
    [deviceToken] : deviceToken;
  const message = this._createMessage(notification);

  debug('Sending message to %j: %j', registrationIds, message);
  this._connection.send(message, registrationIds, 3, function(err, result) {
    if (!err && result && result.failure) {
      const devicesGoneRegistrationIds = [];
      const errors = [];
      let code;
      result.results.forEach(function(value, index) {
        code = value && value.error;
        if (code === 'NotRegistered' || code === 'InvalidRegistration') {
          debug('Device %j is no longer registered.', registrationIds[index]);
          devicesGoneRegistrationIds.push(registrationIds[index]);
        } else if (code) {
          errors.push(g.f('{{GCM}} error code: %s, deviceToken: %s',
            (code || 'Unknown'), registrationIds[index]));
        }
      });

      if (devicesGoneRegistrationIds.length > 0) {
        self.emit('devicesGone', devicesGoneRegistrationIds);
      }

      if (errors.length > 0) {
        err = new Error(errors.join('\n'));
      }
    }

    if (err) {
      debug('Cannot send message: %s', err.stack);
      self.emit('error', err);
      return;
    }

    debug('GCM result: %j', result);
  });
};

GcmProvider.prototype._createMessage = function(notification) {
  // Message parameters are documented here:
  //   https://developers.google.com/cloud-messaging/server-ref
  const message = new gcm.Message({
    timeToLive: notification.getTimeToLiveInSecondsFromNow(),
    collapseKey: notification.collapseKey,
    delayWhileIdle: notification.delayWhileIdle,
  });

  const propNames = Object.keys(notification);
  // GCM does not have reserved message parameters for alert or badge, adding them as data.
  propNames.push('alert', 'badge');

  propNames.forEach(function(key) {
    if (notification[key] !== null &&
        typeof notification[key] !== 'undefined') {
      message.addData(key, notification[key]);
    }
  });

  addKey(message, 'title', notification, 'messageFrom');
  addKey(message, 'body', notification, 'alert');

  ['icon', 'sound', 'badge', 'tag', 'color', 'click_action']
    .forEach(function(prop) {
      if (notification[prop]) {
        addKey(message, prop, notification);
      }
    });

  return message;
};

function addKey(message, key, notification, prop) {
  prop = prop || key;
  if (notification.dataOnly) {
    message.addData(key, notification[prop]);
  } else {
    message.addNotification(key, notification[prop]);
  }
}
