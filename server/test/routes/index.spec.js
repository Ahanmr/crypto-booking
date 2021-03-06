/* eslint-env mocha */
require('dotenv').config({ path: './test/utils/.env' });
const { expect } = require('chai');
const mongoose = require('mongoose');
const request = require('request-promise-native');
const sinon = require('sinon');
const sgMail = require('@sendgrid/mail');
const { SERVER_PORT, BOOKING_POC_ADDRESS } = require('../../src/config');
const throttling = require('../../src/middlewares/throttling');
const prices = require('../../src/services/prices');
const {
  turnOffRecaptcha,
  turnOnRecaptcha,
} = require('../../src/middlewares/recaptcha');

const { validBooking, validLifBooking, validBookingWithEthPrice } = require('../utils/test-data');

const apiUrl = `http://localhost:${SERVER_PORT}/api`;
let server;
let BookingModel;
before(async () => {
  server = await require('../../src/index.js');
  BookingModel = mongoose.model('Booking');
});
after(async () => {
  const { ethereunListenerCron, expiredBookingCron } = require('../../src/app');
  ethereunListenerCron.destroy();
  expiredBookingCron.destroy();
  await server.close();
  await mongoose.connection.close();
});
describe('Booking API', () => {
  let sandbox;
  before(() => {
    sandbox = sinon.createSandbox();
  });
  afterEach(async function () {
    await BookingModel.remove({}).exec();
    sandbox.restore();
    throttling.turnOnThrottling();
  });
  beforeEach(async function () {
    await BookingModel.resetIndex();
    throttling.turnOffThrottling();
    sandbox.stub(sgMail, 'send')
      .returns((data, cb) => ({ id: '<Some.id@server>', message: 'Queued. Thank you.' }));
    sandbox.stub(prices, 'fetchETHPrice')
      .returns(() => '500');
  });
  describe('POST /api/booking', () => {
    describe('Recaptcha', () => {
      before(async () => {
        turnOnRecaptcha();
      });
      after(async () => {
        turnOffRecaptcha();
      });
      it('Should throw with #noRecaptcha', async () => {
        try {
          const body = validBooking;
          await request({ url: `${apiUrl}/booking`, method: 'POST', json: true, body });
        } catch (e) {
          expect(e).to.have.property('error');
          expect(e.error).to.have.property('code', '#noRecaptcha');
        }
      });
      it('Should throw with #recaptcha', async () => {
        try {
          const body = validBooking;
          body['g-recaptcha-response'] = 'wrongRecaptcha';
          await request({ url: `${apiUrl}/booking`, method: 'POST', json: true, body });
        } catch (e) {
          expect(e).to.have.property('error');
          expect(e.error).to.have.property('code', '#recaptcha');
        }
      });
    });
    it('Should throw with invalid guest ETH address', async () => {
      try {
        await request({ url: `${apiUrl}/booking`, method: 'POST', json: true, body: { ...validBooking, guestEthAddress: '0x9876545678' } });
        throw new Error('should not be called');
      } catch (e) {
        expect(e).to.have.property('error');
        expect(e.error).to.have.property('code', '#guestEthAddressChecksum');
        const sendFake = sandbox.getFakes()[0];
        expect(sendFake).to.have.property('calledOnce', false);
      }
    });
    it('Should create a valid ETH booking', async () => {
      const body = validBooking;
      const { booking, txs, bookingIndex } = await request({ url: `${apiUrl}/booking`, method: 'POST', json: true, body });
      expect(txs.length).to.be.an.equal(1);
      expect(txs[0]).to.have.property('to');
      expect(txs[0]).to.have.property('data');
      expect(txs[0]).to.have.property('gas');
      expect(txs[0]).to.have.property('value');
      expect(booking).to.have.property('_id');
      expect(booking).to.have.property('bookingHash');
      expect(booking).to.have.property('guestEthAddress', validBooking.guestEthAddress);
      expect(booking).to.have.property('paymentAmount');
      expect(booking).to.have.property('paymentType', validBooking.paymentType);
      expect(booking).to.have.property('signatureTimestamp');
      expect(booking).to.have.property('guestCount', validBooking.guestCount);
      expect(booking.signatureTimestamp).to.have.a('number');
      expect(booking).to.have.property('personalInfo');
      expect(booking.personalInfo).to.have.property('fullName', validBooking.personalInfo.fullName);
      expect(booking.personalInfo).to.have.property('email', validBooking.personalInfo.email);
      expect(booking.personalInfo).to.have.property('birthDate', validBooking.personalInfo.birthDate);
      expect(booking.personalInfo).to.have.property('phone', validBooking.personalInfo.phone);
      expect(booking.personalInfo).to.have.property('phone', validBooking.personalInfo.phone);
      expect(bookingIndex).to.be.a('number');
      const sendFake = sandbox.getFakes()[0];
      expect(sendFake).to.have.property('calledOnce', true);
    });
    it('Should create a valid LIF booking', async () => {
      const body = validLifBooking;
      const { booking, txs, bookingIndex } = await request({ url: `${apiUrl}/booking`, method: 'POST', json: true, body });
      expect(txs.length).to.be.an.equal(2);
      expect(txs[1]).to.have.property('to');
      expect(txs[1]).to.have.property('data');
      expect(txs[1]).to.have.property('gas');
      expect(txs[1]).to.have.property('value');
      expect(booking).to.have.property('_id');
      expect(booking).to.have.property('bookingHash');
      expect(booking).to.have.property('guestEthAddress', validLifBooking.guestEthAddress);
      expect(booking).to.have.property('paymentAmount');
      expect(booking).to.have.property('paymentType', validLifBooking.paymentType);
      expect(booking).to.have.property('signatureTimestamp');
      expect(booking.signatureTimestamp).to.have.a('number');
      expect(booking).to.have.property('personalInfo');
      expect(booking.personalInfo).to.have.property('fullName', validLifBooking.personalInfo.fullName);
      expect(booking.personalInfo).to.have.property('email', validLifBooking.personalInfo.email);
      expect(booking.personalInfo).to.have.property('birthDate', validLifBooking.personalInfo.birthDate);
      expect(booking.personalInfo).to.have.property('phone', validLifBooking.personalInfo.phone);
      expect(bookingIndex).to.be.a('number');
      const sendFake = sandbox.getFakes()[0];
      expect(sendFake).to.have.property('calledOnce', true);
    });
    it('Should propagate data errors', async () => {
      const body = Object.assign({}, validBooking, { roomType: -1 });

      try {
        await request({ url: `${apiUrl}/booking`, method: 'POST', json: true, body });
        throw new Error('should not be called');
      } catch (e) {
        expect(e).to.have.property('error');
        expect(e.error).to.have.property('code', '#invalidRoomType');
      }
    });
  });

  describe('GET /api/booking/:bookingHash', () => {
    it('Should read a booking', async () => {
      const dbBooking = await BookingModel.generate(validBookingWithEthPrice, validBookingWithEthPrice.privateKey);
      await dbBooking.save();
      const index = 0;
      const booking = await request({ url: `${apiUrl}/booking/${dbBooking.bookingHash}?bookingIndex=${index}`, method: 'GET', json: true });
      expect(booking).to.have.property('_id');
      expect(booking).to.have.property('bookingHash');
      expect(booking).to.have.property('guestEthAddress', validBooking.guestEthAddress);
      expect(booking).to.have.property('paymentAmount');
      expect(booking).to.have.property('paymentType', validBooking.paymentType);
      expect(booking).to.have.property('signatureTimestamp');
      expect(booking).to.have.property('guestCount', validBooking.guestCount);
      expect(booking.signatureTimestamp).to.have.a('number');
      expect(booking).to.have.property('personalInfo');
      expect(booking.personalInfo).to.have.property('fullName', validBooking.personalInfo.fullName);
      expect(booking.personalInfo).to.have.property('email', validBooking.personalInfo.email);
      expect(booking.personalInfo).to.have.property('birthDate', validBooking.personalInfo.birthDate);
      expect(booking.personalInfo).to.have.property('phone', validBooking.personalInfo.phone);
    });
    it('Should propagate data errors', async () => {
      try {
        await request({ url: `${apiUrl}/booking/some-invalid-id`, method: 'GET', json: true });
        throw new Error('should not be called');
      } catch (e) {
        expect(e).to.have.property('error');
        expect(e.error).to.have.property('code', '#notFound');
      }
    });
  });

  describe('POST /api/booking/emailInfo', () => {
    it('Should read a booking', async () => {
      const dbBooking = await BookingModel.generate(validBookingWithEthPrice, validBookingWithEthPrice.privateKey);
      await dbBooking.save();
      const body = { bookingHash: dbBooking.bookingHash };
      const response = await request({ url: `${apiUrl}/booking/emailInfo`, method: 'POST', json: true, body });
      expect(response).to.have.property('status', 'ok');
    });
    it('Should propagate data errors', async () => {
      try {
        const body = { bookingHash: 'invalid booking' };
        await request({ url: `${apiUrl}/booking/emailInfo`, method: 'POST', json: true, body });
        throw new Error('should not be called');
      } catch (e) {
        expect(e).to.have.property('error');
        expect(e.error).to.have.property('code', '#sendBookingInfoFail');
      }
    });
    it('should respond with 429 when throttling limit is exceeded', async () => {
      throttling.turnOnThrottling();
      const dbBooking = await BookingModel.generate(validBookingWithEthPrice, validBookingWithEthPrice.privateKey);
      await dbBooking.save();
      const body = { bookingHash: dbBooking.bookingHash };
      let response = await request({ url: `${apiUrl}/booking/emailInfo`, method: 'POST', json: true, body });
      expect(response).to.have.property('status', 'ok');
      response = await request({ url: `${apiUrl}/booking/emailInfo`, method: 'POST', json: true, body });
      expect(response).to.have.property('status', 'ok');
      response = await request({ url: `${apiUrl}/booking/emailInfo`, method: 'POST', json: true, body });
      expect(response).to.have.property('status', 'ok');
      try {
        await request({ url: `${apiUrl}/booking/emailInfo`, method: 'POST', json: true, body });
        throw new Error('should not be called');
      } catch (e) {
        expect(e).to.have.property('error');
        expect(e.error).to.have.property('code', '#rateLimit');
      }
    });
  });

  describe('DELETE /api/booking', () => {
    it('Should delete a booking', async () => {
      const dbBooking = await BookingModel.generate(validBookingWithEthPrice, validBookingWithEthPrice.privateKey);
      await dbBooking.save();
      await dbBooking.setAsApproved();
      const body = { bookingHash: validBookingWithEthPrice.bookingHash };
      const { tx } = await request({ url: `${apiUrl}/booking`, method: 'DELETE', json: true, body });
      expect(tx).to.have.property('to', BOOKING_POC_ADDRESS);
      expect(tx).to.have.property('data');
      expect(tx).to.have.property('value', 0);
      expect(tx).to.have.property('gas');
    });
    it('Should retrun 404 for invalid bookingHash', async () => {
      try {
        const body = { bookingHash: 'invalidHash' };
        await request({ url: `${apiUrl}/booking`, method: 'DELETE', json: true, body });
        throw new Error('should not be called');
      } catch (e) {
        expect(e).to.have.property('error');
        expect(e.error).to.have.property('code', '#bookingNotFound');
      }
    });
    it('Should retrun 404 for non approved booking', async () => {
      try {
        const dbBooking = await BookingModel.generate(validBookingWithEthPrice, validBookingWithEthPrice.privateKey);
        await dbBooking.save();
        const body = { bookingHash: validBookingWithEthPrice.bookingHash };
        await request({ url: `${apiUrl}/booking`, method: 'DELETE', json: true, body });
        throw new Error('should not be called');
      } catch (e) {
        expect(e).to.have.property('error');
        expect(e.error).to.have.property('code', '#bookingNotFound');
      }
    });
  });
});

describe('GET /', () => {
  it('Should return valid fields', async () => {
    const body = validBooking;
    const resp = await request({ url: `http://localhost:${SERVER_PORT}/`, method: 'GET', json: true, body });
    expect(resp).to.have.property('docs');
    expect(resp).to.have.property('info');
    expect(resp).to.have.property('info');
    expect(resp).to.have.property('version');
    expect(resp).to.have.property('bookingPoC');
    expect(resp).to.have.property('commit');
  });
});
