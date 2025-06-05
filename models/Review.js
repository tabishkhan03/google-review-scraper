import mongoose from 'mongoose';

const reviewItemSchema = new mongoose.Schema({
  reviewer: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 0,
    max: 5
  },
  content: {
    type: String,
    default: ''
  },
  dateIso: {
    type: Date,
    required: true
  }
}, { _id: false }); // No _id for subdocuments

const placeReviewSchema = new mongoose.Schema({
  placeId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  placeName: {
    type: String,
    required: true
  },
  reviews: [reviewItemSchema],
  lastScraped: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Index for efficient sorting of reviews by date
placeReviewSchema.index({ "reviews.dateIso": -1 });

const Review = mongoose.model('Review', placeReviewSchema);

export default Review;