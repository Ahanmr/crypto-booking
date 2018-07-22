const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const SIGNATURE_LIMIT = 30;

const Booking = new Schema({
  publicKey: {
    type: String,
    required: [true, 'noPublicKey'],
  },
  guestEthAddress: {
    type: String,
    unique: true,
    required: [true, 'noGuestEthAddress'],
  },
  payment: {
    amount: {
      type: Number,
      validate: {
        validator: function (amount) {
          return amount > 0;
        },
        message: 'minAmount',
      },
      required: [true, 'noPaymentAmount'],
    },
    type: {
      type: String,
      enum: ['eth', 'lif'],
      required: [true, 'noPaymentType'],
    },
    tx: {
      type: String,
    },
  },
  signatureTimestamp: {
    type: Date,
    default: function () {
      return Date.now() + SIGNATURE_LIMIT * 60 * 1000;
    },
    required: [true, 'noSignatureTimestamp'],
  },
  personalInfo: {
    type: String,
    required: [true, 'noPersonalInfo'],
  },
});

module.exports = { Booking: mongoose.model('Booking', Booking) };
