import mongoose, { trusted } from "mongoose";

const paitentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  diagnosedWith: {
    type: String,
    required: true
  },
  adress: {
    type: String,
    required: true
  },
  age: {
    type: Number,
    required: true
  },
  bloodGroup: {
    type: String,
    required: true
  },
  gender: {
    type: String,
    enum: ["Male", "Female", "Others"],
    required: true
  },
  admittedIn: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital"
  }
}, { timestamps: true});

export const Paitent = mongoose.model("Paitent", paitentSchema);
