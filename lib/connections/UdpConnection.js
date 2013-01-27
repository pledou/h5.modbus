var util = require('util');
var dgram = require('dgram');
var Connection = require('../Connection');

module.exports = UdpConnection;

/**
 * @name h5.modbus.connections.UdpConnection
 * @constructor
 * @extends {h5.modbus.Connection}
 * @param {h5.modbus.connections.UdpConnection.Options|object} options
 * @event error
 * @event data
 */
function UdpConnection(options)
{
  Connection.call(this);

  /**
   * @private
   * @type {h5.modbus.connections.UdpConnection.Options}
   */
  this.options = options instanceof UdpConnection.Options
    ? options
    : new UdpConnection.Options(options);

  /**
   * @private
   * @type {dgram.Socket}
   */
  this.socket = this.setUpSocket();
}

util.inherits(UdpConnection, Connection);

/**
 * @name h5.modbus.connections.UdpConnection.Options
 * @constructor
 * @param {object} options
 * @param {dgram.Socket} options.socket
 * @param {string=} options.host
 * @param {number=} options.port
 */
UdpConnection.Options = function(options)
{
  if (!(options.socket instanceof dgram.Socket))
  {
    throw new Error("Option `socket` is required and must be of type `dgram.Socket`.");
  }

  /**
   * @type {dgram.Socket}
   */
  this.socket = options.socket;

  /**
   * @type {string}
   */
  this.host = typeof options.host === 'string' ? options.host : '127.0.0.1';

  /**
   * @type {number}
   */
  this.port = typeof options.port === 'number' ? options.port : 502;
};

/**
 * @param {Buffer} data
 */
UdpConnection.prototype.write = function(data)
{
  try
  {
    this.socket.send(
      data, 0, data.length, this.options.port, this.options.host
    );
  }
  catch (err)
  {
    this.emit('error', err);
  }
};

/**
 * @private
 * @return {dgram.Socket}
 */
UdpConnection.prototype.setUpSocket = function()
{
  this.onSocketError = this.onSocketError.bind(this);
  this.onSocketMessage = this.onSocketMessage.bind(this);

  var socket = this.options.socket;

  socket.on('error', this.onSocketError);
  socket.on('message', this.onSocketMessage);

  return socket;
};

/**
 * @private
 * @param {Error} error
 */
UdpConnection.prototype.onSocketError = function(error)
{
  this.emit('error', error);
};

/**
 * @private
 * @param {Buffer} message
 */
UdpConnection.prototype.onSocketMessage = function(message)
{
  this.emit('data', message);
};