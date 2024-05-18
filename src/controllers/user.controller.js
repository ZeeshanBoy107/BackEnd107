import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.models.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"
import mongoose from "mongoose";

const generateTokens = async(userId) => {
  try {
    const user = await User.findById(userId)
    const accessToken = user.generateAccessToken()
    const refreshToken = user.generateRefreshToken()

    user.refreshToken = refreshToken
    await user.save({validateBeforeSave: false})

    return {accessToken, refreshToken}

  } catch (error) {
    throw new ApiError(500, "Something went Wrong")
  }
}

const registerUser = asyncHandler( async (req, res) => {
  // get user details from frondend
  
  const{ fullname, email, username, password } = req.body

  // validation - not empty

  if (
    [fullname, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required")
  }

  // if(fullname === "") {
  //   throw ApiError(400, "fullname is required")
  // }


  // check if user already exists: username, email

  const existUser = await User.findOne({
    $or: [{username}, {email}]
  })

  if(existUser) {
    throw new ApiError(409, "User with email or username exists")
  }

  // check for images, check for avatar

  const avatarLocalPath = req.files?.avatar[0]?.path;
  
  let coverImageLocalPath;
  if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
    coverImageLocalPath = req.files.coverImage[0].path
  }

  if(!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required")
  }

  //upload them to cloudinary

  const avatar = await uploadOnCloudinary(avatarLocalPath)
  const coverImage = await uploadOnCloudinary(coverImageLocalPath)

  if(!avatar) {
    throw new ApiError(400, "Avatar file is required")
  } 

  // create user object - create entry in db

  const user = await User.create({
    fullname,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase()
  })

  // remove password and refresh token field from rersponse

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  )

  // check for user creation

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user")
  }


  //return response

  return res.status(201).json(
    new ApiResponse(200, createdUser, "User Registered Successfully")
  )
})

const loginUser = asyncHandler(async (req, res) => {
  // req body -> data

  const {email, username, password}  = req.body
  // username or email

  if (!username && !email) {
    throw new ApiError(400, "username or password is required");
  }
  // find the user

  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

   if (!user) {
     throw new ApiError(404, "User doesn't exist");
   }

  // password check

   const isPasswordValid = await user.isPasswordCorrect(password)

   if (!password) {
     throw new ApiError(401, "Invalid User Credentials");
   }

  // access and refresh token

   const {accessToken, refreshToken} = await generateTokens(user._id)

  // send cookie

   const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

   const options = {
    httOnly: true,
    secure: true
   }

   return res.
   status(200).
   cookie("accessToken", accessToken, options)
   .cookie("refreshToken", refreshToken, options)
   .json(
    new ApiResponse(
      200,
      {
        user: loggedInUser, accessToken, refreshToken
      },
      "User logged in Successfully"
    )
  )
})

const logoutUser = asyncHandler( async(req, res) => {
    await User.findByIdAndUpdate(
      req.user._id,
      {
        $unset: {
          refreshToken: 1
        }
      },
      {
        new: true
      }
    )

    const options = {
      httOnly: true,
      secure: true,
    };

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {},  "User Logged Out"))
  })

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

  if(!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request")
  }

  try {
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
  
    const user = await User.findById(decodedToken?._id)
  
    if (!user) {
      throw new ApiError(401, "Invalid Refresh Token");
    }
  
    if(incomingRefreshToken !== user?.refreshToken) {
       throw new ApiError(401, "Refresh Token is Expired or Used");
    }
  
    const options = {
      httOnly: true,
      secure: true
    }
  
    const {newAccessToken, newRefreshToken} = await generateTokens(user._id)
  
    return res.status(200)
    .cookie("accessToken", newAccessToken, options)
    .cookie("refreshToken", newRefreshToken, options)
    .json( ApiResponse(
      200,
      {accessToken: newAccessToken, refreshToken: newRefreshToken},
      "Access Token Refreshed"
    )
  )
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token")
  }
})

const changeCurrentPassword = asyncHandler(async(req, res) => {
  const {oldPassword, newPassword} = req.body

  const user = await User.findById(req.user?._id)

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid Password")
  }

  user.password = newPassword;

  await user.save({validateBeforeSave: false})

  return res
  .status(200)
  .json(new ApiResponse(
    200, {},
    "Password changed successfully" 
  ))
}
)

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
  .status(200)
  .json(new ApiResponse(
    200, req.user, "Current user fetched successfully"))
})

const updateAccountDetails = asyncHandler(async(req, res) => {
  const {fullname, email} = req.body

  if(!fullname || !email) {
    throw new ApiError(400, "All fields are required")
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullname,
        email
      }
    },
    {new: true}
  ).select("-password")

  return res
  .status(200)
  .status(new ApiResponse(200, user,  "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async(req, res) => {
  const avatarLocalPath = req.file?.path

  if(!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is missing")
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath)

  if(!avatar.url) {
    throw new ApiError(400, "Error while uploading Avatar");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url
      }
    },
    {new: true}
  ).select("-password")

  return res
    .status(200)
    .json(new ApiResponse(200, user, "CoverImage updated successfully"));
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path;

  if (!coverImageLocalPath) {
    throw new ApiError(400, "Avatar file is missing");
  }

  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading CoverImage");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url,
      },
    },
    { new: true }
  ).select("-password");

  return res
  .status(200)
  .json(new ApiResponse(200, user, "CoverImage updated successfully"))
});

const getUserChannelProfile = asyncHandler(async(req, res) => {
  const {username} = req.params

  if(!username?.trim()) {
    throw new ApiError(400, "Username is missing")
  }

  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      }
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "-id",
        foreignField: "channel",
        as: "subscribers",
      }
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "-id",
        foreignField: "subscribers",
        as: "subscribedTo",
      }
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers"
        },
        channelsSubscribedToCount: {
          $size: "$subscribedTo"
        },
        isSubscribed: {
          $cond: {
            if: {$in: [req.user?._i, "$subscribers.subscriber"]},
            then: true,
            else: false
          }
        }
      }
    },
    {
      $project: {
        fullname: 1,
        username: 1,
        subscribersCount: 1,
        channelsSubscribedToCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
        createdAt: 1
      }
    }
  ]);

  if(!channel?.length) {
    throw new ApiError(404, "Channel does not exists")
  }

  return res
  .status(200)
  .json(
    new ApiResponse(200, channel[0], "User channel fetched successfully")
  )
})

const getWatchHistoy = asyncHandler(async(req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types(req.user._id),
      },
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipeline: [
          {
            $lookup: {
              from: "videos",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipeline: [
                {
                  $project: {
                    fullname: 1,
                    username: 1,
                    avatar: 1
                  }
                }
              ]
            },
          },
          {
            $addFields: {
              owner: {
                $first: "$owner"
              }
            }
          }
        ],
      },
    },
  ])

  return res
  .status(200)
  .json(
    new ApiResponse(200, user[0].watchHistory, "WatchHistory fetched successfully")
  )
})

export {
  registerUser, 
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistoy
}