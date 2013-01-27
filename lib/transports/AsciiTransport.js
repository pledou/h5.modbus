var util = require('util');
var buffers = require('h5.buffers');
var errors = require('../errors');
var Transport = require('../Transport');

module.exports = AsciiTransport;

/**
 * @private
 * @const
 * @type {number}
 */
var FRAME_START = 0x3A;

/**
 * @private
 * @const
 * @type {number}
 */
var FRAME_CR = 0x0D;

/**
 * @private
 * @const
 * @type {number}
 */
var FRAME_LF = 0x0A;

/**
 * @name h5.modbus.transports.AsciiTransport
 * @constructor
 * @extends {h5.modbus.Transport}
 * @param {h5.modbus.Connection} connection
 */
function AsciiTransport(connection)
{
  Transport.call(this);

  /**
   * @private
   * @type {h5.modbus.Connection}
   */
  this.connection = connection;
  this.connection.on('data', this.onData.bind(this));

  /**
   * @private
   * @type {Transaction}
   */
  this.transaction = null;

  /**
   * @private
   * @type {h5.buffers.BufferQueueReader}
   */
  this.reader = new buffers.BufferQueueReader();

  /**
   * @private
   * @type {number}
   */
  this.lastByte = -1;

  /**
   * @private
   * @type {function(function)}
   */
  this.handleTimeout = this.handleTimeout.bind(this);
}

util.inherits(AsciiTransport, Transport);

/**
 * @param {h5.modbus.Transaction} transaction
 * @throws {Error}
 */
AsciiTransport.prototype.sendRequest = function(transaction)
{
  if (this.transaction !== null)
  {
    throw new Error("Can not send another request while the previous one has not yet completed.");
  }

  this.transaction = transaction;

  this.connection.write(this.getAdu(transaction));

  transaction.start(this.handleTimeout);
};

/**
 * @private
 * @param {h5.modbus.Transaction} transaction
 * @return {Buffer}
 */
AsciiTransport.prototype.getAdu = function(transaction)
{
  var adu = transaction.getAdu();

  if (adu === null)
  {
    adu = this.buildAdu(transaction);
  }

  return adu;
};

/**
 * @private
 * @param {h5.modbus.Transaction} transaction
 * @return {Buffer}
 */
AsciiTransport.prototype.buildAdu = function(transaction)
{
  var request = transaction.getRequest();
  var pdu = request.toBuffer();
  var adu = this.frame(transaction.getUnit(), pdu);

  transaction.setAdu(adu);

  return adu;
};

/**
 * @private
 * @param {number} unit
 * @param {Buffer} pdu
 * @return {Buffer}
 */
AsciiTransport.prototype.frame = function(unit, pdu)
{
  var frame = new Buffer(7 + pdu.length * 2);
  var i = 0;

  frame[i++] = FRAME_START;
  frame[i++] = this.encodeNibble(this.high(unit));
  frame[i++] = this.encodeNibble(this.low(unit));

  for (var j = 0, l = pdu.length; j < l; ++j)
  {
    frame[i++] = this.encodeNibble(this.high(pdu[j]));
    frame[i++] = this.encodeNibble(this.low(pdu[j]));
  }

  var checksum = this.lrc(unit, pdu);

  frame[i++] = this.encodeNibble(this.high(checksum));
  frame[i++] = this.encodeNibble(this.low(checksum));
  frame[i++] = FRAME_CR;
  frame[i] = FRAME_LF;

  return frame;
};

/**
 * @private
 * @param {number} initial
 * @param {Buffer|Array.<number>} buffer
 * @return {number}
 */
AsciiTransport.prototype.lrc = function(initial, buffer)
{
  var result = initial & 0xFF;

  for (var i = 0, l = buffer.length; i < l; ++i)
  {
    result += buffer[i] & 0xFF;
  }

  return ((result ^ 0xFF) + 1) & 0xFF;
};

/**
 * @private
 * @param {number} byt3
 * @return {number}
 */
AsciiTransport.prototype.high = function(byt3)
{
  return ((byt3 & 0xF0) >>> 4) & 0xFF;
};

/**
 * @private
 * @param {number} byt3
 * @return {number}
 */
AsciiTransport.prototype.low = function(byt3)
{
  return ((byt3 & 0x0F) >>> 0) & 0xFF;
};

/**
 * @private
 * @param {number} nibble
 * @return {number}
 */
AsciiTransport.prototype.encodeNibble = function(nibble)
{
  return nibble + (nibble < 10 ? 48 : 55);
};

/**
 * @private
 * @param {number} nibble
 * @return {number}
 */
AsciiTransport.prototype.decodeNibble = function(nibble)
{
  return nibble - (nibble < 65 ? 48 : 55);
};

/**
 * @private
 * @param {number} highNibble
 * @param {number} lowNibble
 * @return {number}
 */
AsciiTransport.prototype.decodeByte = function(highNibble, lowNibble)
{
  return (this.decodeNibble(highNibble) << 4)
    + (this.decodeNibble(lowNibble) << 0);
};

/**
 * @private
 * @param {Array.<number>} bytes
 * @return {Array.<number>}
 */
AsciiTransport.prototype.decodeBytes = function(bytes)
{
  var result = [];

  while (bytes.length > 0)
  {
    result.push(this.decodeByte(bytes.shift(), bytes.shift()));
  }

  return result;
};

/**
 * @private
 */
AsciiTransport.prototype.handleTimeout = function()
{
  this.skipResponseData();
};

/**
 * @private
 */
AsciiTransport.prototype.skipResponseData = function()
{
  if (this.reader.length > 0)
  {
    this.reader.skip(this.reader.length);
  }

  this.transaction = null;
};

/**
 * @private
 * @param {Buffer} data
 */
AsciiTransport.prototype.onData = function(data)
{
  var transaction = this.transaction;

  if (transaction === null)
  {
    return;
  }

  if (!this.isValidChunk(data))
  {
    this.skipResponseData();

    transaction.handleError(new errors.InvalidResponseDataError());

    return;
  }

  this.reader.push(data);

  if (this.endsWithCrLf(data))
  {
    this.handleFrameData();
  }
};

/**
 * @private
 * @param {Buffer} chunk
 * @return {boolean}
 */
AsciiTransport.prototype.isValidChunk = function(chunk)
{
  return this.reader.length > 0 || chunk[0] === FRAME_START;
};

/**
 * @private
 * @param {Buffer} chunk
 * @return {boolean}
 */
AsciiTransport.prototype.endsWithCrLf = function(chunk)
{
  var lastByte = this.lastByte;

  this.lastByte = chunk[chunk.length - 1];

  if (chunk.length === 1)
  {
    return lastByte === FRAME_CR && chunk[0] === FRAME_LF;
  }

  return chunk[chunk.length - 2] === FRAME_CR && this.lastByte === FRAME_CR;
};

/**
 * @private
 */
AsciiTransport.prototype.handleFrameData = function()
{
  this.reader.skip(1);

  var frame = this.decodeBytes(this.reader.shiftBytes(this.reader.length - 2));
  var checksum = frame.pop();
  var transaction = this.transaction;

  this.skipResponseData();

  var validationError = this.validate(transaction, frame, checksum);

  if (validationError !== null)
  {
    transaction.handleError(validationError);

    return;
  }

  var request = transaction.getRequest();

  try
  {
    transaction.handleResponse(request.createResponse(new Buffer(frame)));
  }
  catch (error)
  {
    transaction.handleError(error);
  }
};

/**
 * @private
 * @param {h5.modbus.Transaction} transaction
 * @param {Array.<number>} frame
 * @param {number} expectedChecksum
 * @return {Error|null}
 */
AsciiTransport.prototype.validate =
  function(transaction, frame, expectedChecksum)
{
  var actualChecksum = this.lrc(0, frame);

  if (actualChecksum !== expectedChecksum)
  {
    return new errors.InvalidChecksumError();
  }

  var expectedUnit = transaction.getUnit();
  var actualUnit = frame.shift();

  if (actualUnit !== expectedUnit)
  {
    return new errors.InvalidResponseDataError(util.format(
      "Invalid unit specified in the MODBUS response. Expected: %d, got: %d.",
      expectedUnit,
      actualUnit
    ));
  }

  return null;
};