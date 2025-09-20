import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import cors from 'cors';
import User from '../models/User';
import OTP from '../models/OTP';
import { AdminLogin } from '../models/AdminLogin';
import { authenticateToken, rateLimit, AuthRequest } from '../middleware/auth';
import { asyncHandler, sendSuccessResponse, sendErrorResponse, ValidationError } from '../middleware/errorHandler';
import { generateOTP, sendOTPEmail, verifyOTP, getEmailConfigStatus } from '../services/emailService';

const router = express.Router();

// @route   GET /api/auth/verify-token
// @desc    Verify JWT token and return user data
// @access  Private
router.get('/verify-token', authenticateToken, asyncHandler(async (req: AuthRequest, res: express.Response) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Return user data without sensitive information
    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      userType: user.userType,
      companyName: user.companyName,
      company: user.company,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt
    };

    return res.json({
      success: true,
      message: 'Token is valid',
      user: userData
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
}));

// @route   POST /api/auth/refresh-token
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh-token', authenticateToken, asyncHandler(async (req: AuthRequest, res: express.Response) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new token
    const token = jwt.sign(
      { userId: user._id, userType: user.userType },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Token refreshed successfully',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        companyName: user.companyName,
        company: user.company,
        isActive: user.isActive,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
}));

// Enhanced CORS configuration for OTP endpoints
const otpCorsOptions = {
  origin: function (origin: string | undefined, callback: Function) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'https://me-work.vercel.app',
      'https://studenting.vercel.app',
      'https://studentjobs-frontend.onrender.com',
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
    ];
    
    // Allow all Vercel, Railway, and Render subdomains
    if (origin.includes('.vercel.app') || origin.includes('.railway.app') || origin.includes('.onrender.com')) {
      console.log('✅ OTP CORS: Allowing deployment origin:', origin);
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('✅ OTP CORS: Allowing configured origin:', origin);
      return callback(null, true);
    }
    
    console.log('🚫 OTP CORS blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'Origin', 
    'X-CSRF-Token', 
    'X-API-Key',
    'X-OTP-Token',
    'X-User-Type',
    'X-Email-Verification'
  ],
  exposedHeaders: [
    'Content-Length', 
    'X-OTP-Status',
    'X-Verification-Status',
    'X-User-Type'
  ],
  optionsSuccessStatus: 200,
};

// Apply enhanced CORS to all OTP-related routes
router.use('/login-request-otp', cors(otpCorsOptions));
router.use('/login-verify-otp', cors(otpCorsOptions));
router.use('/send-otp', cors(otpCorsOptions));
router.use('/verify-otp', cors(otpCorsOptions));
router.use('/forgot-password', cors(otpCorsOptions));
router.use('/reset-password', cors(otpCorsOptions));

// Generate JWT token
const generateToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined');
  }
  return jwt.sign(
    { userId },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', asyncHandler(async (req: express.Request, res: express.Response) => {
  const {
    name,
    email,
    phone,
    password,
    userType,
    college,
    skills,
    availability,
    companyName,
    businessType,
    address,
    otp
  } = req.body;

  // Validate required fields
  if (!name || !email || !phone || !password || !userType || !otp) {
    throw new ValidationError('All required fields including OTP must be provided');
  }

  // Validate user type
  if (!['student', 'employer', 'admin'].includes(userType)) {
    throw new ValidationError('Invalid user type');
  }

  // Validate student-specific fields
  if (userType === 'student' && !college) {
    throw new ValidationError('College/University is required for students');
  }

  // Validate employer-specific fields
  if (userType === 'employer' && (!companyName || !businessType || !address)) {
    throw new ValidationError('Company name, business type, and address are required for employers');
  }

  // Verify OTP before proceeding
  const otpValid = await verifyOTP(email, otp, 'verification');
  if (!otpValid) {
    throw new ValidationError('Invalid or expired OTP. Please request a new one.');
  }

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ email }, { phone }]
  });

  if (existingUser) {
    if (existingUser.email === email) {
      throw new ValidationError('Email already registered');
    }
    if (existingUser.phone === phone) {
      throw new ValidationError('Phone number already registered');
    }
  }

  // Create user data
  const userData: any = {
    name,
    email,
    phone,
    password,
    userType,
    emailVerified: true, // Mark as verified since OTP was verified
    submittedAt: new Date()
  };

  // Add student-specific fields
  if (userType === 'student') {
    userData.college = college;
    userData.skills = skills ? skills.split(',').map((s: string) => s.trim()) : [];
    userData.availability = availability || 'flexible';
  }

  // Add employer-specific fields
  if (userType === 'employer') {
    userData.companyName = companyName;
    userData.businessType = businessType;
    userData.address = address;
    userData.isVerified = false; // Employers need verification
  }

  // Create user
  const user = await User.create(userData);

  // Generate token
  const token = generateToken((user._id as any).toString());

  // Set headers BEFORE sending body
  res.setHeader('X-OTP-Status', 'verified');
  res.setHeader('X-Verification-Status', 'success');
  res.setHeader('X-User-Type', user.userType);

  // Send response
  sendSuccessResponse(res, {
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      college: user.college,
      skills: user.skills,
      availability: user.availability,
      companyName: user.companyName,
      businessType: user.businessType,
      address: user.address,
      isVerified: user.isVerified,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt
    },
    token
  }, 'User registered successfully', 201);
}));

// @route   POST /api/auth/login
// @desc    Login with email and password
// @access  Public
router.post('/login', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { email, password, userType } = req.body;

  console.log('🔐 Login attempt:', { email, userType, passwordLength: password?.length });

  // Validate input
  if (!email || !password || !userType) {
    console.log('❌ Missing required fields');
    throw new ValidationError('Email, password, and user type are required');
  }

  // Validate user type
  if (!['student', 'employer', 'admin'].includes(userType)) {
    console.log('❌ Invalid user type:', userType);
    throw new ValidationError('Invalid user type');
  }

  // Admin access validation - check if admin exists in MongoDB
  if (userType === 'admin') {
    const adminUser = await User.findOne({ email, userType: 'admin' });
    if (!adminUser) {
      console.log('❌ Admin login attempt with non-existent admin email:', email);
      
      // Log failed admin login attempt
      try {
        await AdminLogin.create({
          adminId: new mongoose.Types.ObjectId(), // Dummy ID for non-existent admin
          adminEmail: email,
          adminName: 'Unknown',
          loginStatus: 'failed',
          failureReason: 'Admin account not found',
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent')
        });
      } catch (logError) {
        console.error('Failed to log admin login attempt:', logError);
      }
      
      throw new ValidationError('Access denied. Admin account not found.');
    }
    if (!adminUser.isActive) {
      console.log('❌ Admin login attempt with inactive admin account:', email);
      
      // Log failed admin login attempt
      try {
        await AdminLogin.create({
          adminId: adminUser._id,
          adminEmail: email,
          adminName: adminUser.name,
          loginStatus: 'failed',
          failureReason: 'Admin account is deactivated',
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent')
        });
      } catch (logError) {
        console.error('Failed to log admin login attempt:', logError);
      }
      
      throw new ValidationError('Access denied. Admin account is deactivated.');
    }
  }

  // Find user by email
  const user = await User.findOne({ email });
  if (!user) {
    console.log('❌ User not found:', email);
    throw new ValidationError('No account found with this email address');
  }

  console.log('✅ User found:', { id: user._id, email: user.email, userType: user.userType });

  // Check if user type matches
  if (user.userType !== userType) {
    console.log('❌ User type mismatch:', { expected: userType, actual: user.userType });
    throw new ValidationError('Invalid user type for this account');
  }

  // Check if user is active
  if (!user.isActive) {
    console.log('❌ Account deactivated:', email);
    throw new ValidationError('Account is deactivated');
  }

  // Compare password
  console.log('🔍 Comparing password...');
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    console.log('❌ Password mismatch for:', email);
    
    // Log failed admin login attempt (wrong password)
    if (userType === 'admin') {
      try {
        await AdminLogin.create({
          adminId: user._id,
          adminEmail: user.email,
          adminName: user.name,
          loginStatus: 'failed',
          failureReason: 'Incorrect password',
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent')
        });
      } catch (logError) {
        console.error('Failed to log admin login attempt:', logError);
      }
    }
    
    throw new ValidationError('Incorrect password');
  }

  console.log('✅ Password verified for:', email);

  // Generate token
  const token = generateToken((user._id as any).toString());

  console.log('🎉 Login successful for:', email);

  // Log successful admin login
  if (userType === 'admin') {
    try {
      await AdminLogin.create({
        adminId: user._id,
        adminEmail: user.email,
        adminName: user.name,
        loginStatus: 'success',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent')
      });
      console.log('📝 Admin login logged successfully');
    } catch (logError) {
      console.error('Failed to log admin login:', logError);
    }
  }

  // Send response
  sendSuccessResponse(res, {
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      college: user.college,
      skills: user.skills,
      availability: user.availability,
      companyName: user.companyName,
      businessType: user.businessType,
      address: user.address,
      isVerified: user.isVerified,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt
    },
    token
  }, 'Login successful');
}));

// @route   POST /api/auth/login-request-otp
// @desc    Request OTP for login
// @access  Public
router.post('/login-request-otp', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { email, userType } = req.body;
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const normalizedUserType = String(userType || '').toLowerCase().trim();

  console.log('🔐 OTP Login Request:', {
    email: normalizedEmail,
    requestedUserType: normalizedUserType,
    allowedUserTypes: ['student', 'employer', 'admin'],
    db: (mongoose.connection as any)?.db?.databaseName,
    host: (mongoose.connection as any)?.host
  });

  // Validate input
  if (!normalizedEmail || !normalizedUserType) {
    throw new ValidationError('Email and user type are required');
  }

  // Validate user type
  if (!['student', 'employer', 'admin'].includes(normalizedUserType)) {
    throw new ValidationError('Invalid user type');
  }

  // Admin email restriction - only allow specific admin emails
  const allowedAdminEmails = ['mework2003@gmail.com', 'admin@studentjobs.com'];
  if (normalizedUserType === 'admin' && !allowedAdminEmails.includes(normalizedEmail)) {
    throw new ValidationError('Access denied. Only authorized admin can log in.');
  }

  // Find user by email
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw new ValidationError('No account found with this email address');
  }

  console.log('✅ User located for OTP login:', {
    id: (user._id as any)?.toString?.() || 'unknown',
    email: user.email,
    userType: user.userType,
    isActive: user.isActive
  });

  // Check if user type matches
  if ((user.userType || '').toLowerCase().trim() !== normalizedUserType) {
    console.log('❌ User type mismatch during OTP request:', {
      email: normalizedEmail,
      requestedUserType: normalizedUserType,
      dbUserType: user.userType
    });
    throw new ValidationError(`userType mismatch: expected ${user.userType}, got ${normalizedUserType}`);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new ValidationError('Account is deactivated');
  }

  // Send OTP for login
  const otp = generateOTP();
  try {
    // Remove any previous login OTPs for this email to prevent conflicts
    const delResult = await OTP.deleteMany({ email: normalizedEmail, purpose: 'login' });
    console.log('🧹 Cleaned previous login OTPs:', { email: normalizedEmail, deletedCount: delResult.deletedCount });

    // Save OTP to database for login purpose
    const otpDoc = await OTP.create({
      email: normalizedEmail,
      otp,
      purpose: 'login'
    });

    console.log('📧 OTP saved to database:', {
      email: normalizedEmail,
      purpose: 'login',
      otp,
      otpId: (otpDoc as any)?._id?.toString?.(),
      expiresAt: (otpDoc as any)?.expiresAt
    });
  } catch (dbErr: any) {
    console.error('❌ Failed to persist OTP for login:', {
      email: normalizedEmail,
      error: dbErr?.message || dbErr
    });
    throw new ValidationError('Unable to generate OTP at the moment. Please try again.');
  }

  // Send email in background to reduce API latency
  Promise.resolve().then(async () => {
    const emailSent = await sendOTPEmail(normalizedEmail, otp, 'login');
    if (!emailSent) {
      const configStatus = getEmailConfigStatus();
      console.error('❌ Failed to send login OTP:', configStatus);
      console.log('🧪 For testing, use OTP: 123456');
    }
    console.log('📨 Login OTP dispatch attempted (see prior logs for provider response).', {
      email: normalizedEmail,
      purpose: 'login'
    });
  }).catch((err) => {
    console.error('❌ Background OTP email send error:', err);
  });

  // Add CORS headers for OTP response BEFORE sending body
  res.setHeader('X-OTP-Status', 'sent');
  res.setHeader('X-User-Type', normalizedUserType);
  res.setHeader('Access-Control-Expose-Headers', 'X-OTP-Status, X-User-Type');

  sendSuccessResponse(res, {
    message: 'OTP sent to your email address',
    email: normalizedEmail,
    userType: normalizedUserType
  }, 'OTP sent successfully');
}));

// @route   POST /api/auth/login-verify-otp
// @desc    Verify OTP and login user
// @access  Public
router.post('/login-verify-otp', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { email, userType, otp } = req.body;
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const normalizedUserType = String(userType || '').toLowerCase().trim();

  // Validate input
  if (!normalizedEmail || !normalizedUserType || !otp) {
    throw new ValidationError('Email, user type, and OTP are required');
  }

  // Validate user type
  if (!['student', 'employer', 'admin'].includes(normalizedUserType)) {
    throw new ValidationError('Invalid user type');
  }

  // Admin email restriction - only allow specific admin emails
  const allowedAdminEmails = ['mework2003@gmail.com', 'admin@studentjobs.com'];
  if (normalizedUserType === 'admin' && !allowedAdminEmails.includes(normalizedEmail)) {
    throw new ValidationError('Access denied. Only authorized admin can log in.');
  }

  // Find user by email
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw new ValidationError('No account found with this email address');
  }

  // Check if user type matches
  if ((user.userType || '').toLowerCase().trim() !== normalizedUserType) {
    console.log('❌ User type mismatch during OTP verification:', {
      email: normalizedEmail,
      requestedUserType: normalizedUserType,
      dbUserType: user.userType
    });
    throw new ValidationError(`userType mismatch: expected ${user.userType}, got ${normalizedUserType}`);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new ValidationError('Account is deactivated');
  }

  // Verify OTP
  const otpValid = await verifyOTP(normalizedEmail, otp, 'login');
  
  // For testing: accept "123456" as a valid OTP regardless of database
  const allowTestOTP = process.env.ALLOW_TEST_OTP === 'true';
  const testOTPCode = process.env.TEST_OTP_CODE || '123456';
  const isTestOTP = allowTestOTP && otp === testOTPCode;
  
  if (!otpValid && !isTestOTP) {
    throw new ValidationError('Invalid or expired OTP. Please request a new one.');
  }
  
  // If using test OTP, log it for debugging
  if (isTestOTP) {
    console.log('🧪 Test OTP used for login:', normalizedEmail);
  }

  // Generate token
  const token = generateToken((user._id as any).toString());

  // Send response
  sendSuccessResponse(res, {
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      college: user.college,
      skills: user.skills,
      availability: user.availability,
      companyName: user.companyName,
      businessType: user.businessType,
      address: user.address,
      isVerified: user.isVerified,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt
    },
    token
  }, 'Login successful');
  
  // Expose headers
  res.setHeader('Access-Control-Expose-Headers', 'X-OTP-Status, X-Verification-Status, X-User-Type');
}));

// @route   POST /api/auth/forgot-password
// @desc    Send password reset OTP
// @access  Public
router.post('/forgot-password', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { email } = req.body;

  if (!email) {
    throw new ValidationError('Email is required');
  }

  // Check if user exists
  const user = await User.findOne({ email });
  if (!user) {
    // Don't reveal if user exists or not for security
    sendSuccessResponse(res, {}, 'If an account with that email exists, an OTP has been sent');
    return;
  }

  // Generate OTP
  const otp = generateOTP();

  // Save OTP to database
  await OTP.create({
    email,
    otp,
    purpose: 'password-reset'
  });

  // Send OTP email
  const emailSent = await sendOTPEmail(email, otp, 'password-reset');

  if (!emailSent) {
    const configStatus = getEmailConfigStatus();
    console.error('❌ Failed to send password reset OTP:', configStatus);
    throw new ValidationError('Failed to send OTP email. Please check your email configuration.');
  }

  sendSuccessResponse(res, {}, 'If an account with that email exists, an OTP has been sent');
  
  // Add CORS headers for password reset OTP
  res.setHeader('X-OTP-Status', 'sent');
  res.setHeader('Access-Control-Expose-Headers', 'X-OTP-Status');
}));

// @route   POST /api/auth/reset-password
// @desc    Reset password with OTP
// @access  Public
router.post('/reset-password', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    throw new ValidationError('Email, OTP, and new password are required');
  }

  // Verify OTP
  const isValid = await verifyOTP(email, otp, 'password-reset');
  if (!isValid) {
    throw new ValidationError('Invalid or expired OTP');
  }

  // Find user and update password
  const user = await User.findOne({ email });
  if (!user) {
    throw new ValidationError('User not found');
  }

  user.password = newPassword;
  await user.save();

  sendSuccessResponse(res, {}, 'Password reset successfully');
  
  // Add CORS headers for password reset success
  res.setHeader('X-OTP-Status', 'verified');
  res.setHeader('X-Verification-Status', 'password-reset-success');
  res.setHeader('Access-Control-Expose-Headers', 'X-OTP-Status, X-Verification-Status');
}));

// @route   POST /api/auth/change-password
// @desc    Change password (authenticated)
// @access  Private
router.post('/change-password', authenticateToken, asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ValidationError('Current password and new password are required');
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    throw new ValidationError('User not found');
  }

  // Verify current password
  const isCurrentPasswordValid = await user.comparePassword(currentPassword);
  if (!isCurrentPasswordValid) {
    throw new ValidationError('Current password is incorrect');
  }

  // Update password
  user.password = newPassword;
  await user.save();

  sendSuccessResponse(res, {}, 'Password changed successfully');
}));

// @route   POST /api/auth/send-otp
// @desc    Send OTP for email verification
// @access  Public
router.post('/send-otp', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { email, purpose = 'verification', userType } = req.body as { email: string; purpose?: string; userType?: string };
  const normalizedEmail = String(email || '').toLowerCase().trim();
  let normalizedPurpose = String(purpose || 'verification').toLowerCase().trim();
  const normalizedUserType = typeof userType === 'string' ? String(userType).toLowerCase().trim() : undefined;

  console.log('📨 Send OTP request:', {
    email: normalizedEmail,
    purpose: normalizedPurpose,
    userType: normalizedUserType,
    allowedPurposes: ['verification', 'password-reset', 'signup', 'login'],
    db: (mongoose.connection as any)?.db?.databaseName,
    host: (mongoose.connection as any)?.host
  });

  if (!normalizedEmail) {
    throw new ValidationError('Email is required');
  }

  // Support alias 'signup' -> 'verification'
  if (normalizedPurpose === 'signup') normalizedPurpose = 'verification';

  // Accept 'login' here as well (when userType is provided), otherwise keep existing valid purposes
  const allowedPurposes = ['verification', 'password-reset', 'login'];
  if (!allowedPurposes.includes(normalizedPurpose)) {
    throw new ValidationError(`Invalid purpose. Allowed: ${allowedPurposes.join(', ')}, also supports alias 'signup' for 'verification'`);
  }

  // For verification during signup, we don't need to check if user exists
  // For password reset, we check if user exists but don't reveal it
  if (normalizedPurpose === 'password-reset') {
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // Don't reveal if user exists or not for security
      sendSuccessResponse(res, {}, 'If an account with that email exists, an OTP has been sent');
      return;
    }
  }

  // If purpose is 'login' via this endpoint, enforce minimal login validations to ensure consistency
  if (normalizedPurpose === 'login') {
    if (!normalizedUserType) {
      throw new ValidationError('userType is required when purpose is login');
    }
    if (!['student', 'employer', 'admin'].includes(normalizedUserType)) {
      throw new ValidationError('Invalid user type');
    }
    const allowedAdminEmails = ['mework2003@gmail.com', 'admin@studentjobs.com'];
    if (normalizedUserType === 'admin' && !allowedAdminEmails.includes(normalizedEmail)) {
      throw new ValidationError('Access denied. Only authorized admin can log in.');
    }
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      throw new ValidationError('No account found with this email address');
    }
    if ((user.userType || '').toLowerCase().trim() !== normalizedUserType) {
      console.log('❌ User type mismatch during send-otp (login purpose):', {
        email: normalizedEmail,
        requestedUserType: normalizedUserType,
        dbUserType: user.userType
      });
      throw new ValidationError(`userType mismatch: expected ${user.userType}, got ${normalizedUserType}`);
    }
    if (!user.isActive) {
      throw new ValidationError('Account is deactivated');
    }
    // Clean prior login OTPs
    await OTP.deleteMany({ email: normalizedEmail, purpose: 'login' });
  }

  // Generate OTP
  const otp = generateOTP();

  // Save OTP to database
  try {
    const otpDoc = await OTP.create({
      email: normalizedEmail,
      otp,
      purpose: normalizedPurpose as any
    });
    console.log('📧 OTP saved to database:', {
      email: normalizedEmail,
      purpose: normalizedPurpose,
      otp,
      otpId: (otpDoc as any)?._id?.toString?.(),
      expiresAt: (otpDoc as any)?.expiresAt
    });
  } catch (dbErr: any) {
    console.error('❌ Failed to persist OTP:', {
      email: normalizedEmail,
      purpose: normalizedPurpose,
      error: dbErr?.message || dbErr
    });
    throw new ValidationError('Unable to generate OTP at the moment. Please try again.');
  }

  // Send OTP email in background
  Promise.resolve().then(async () => {
    const emailSent = await sendOTPEmail(normalizedEmail, otp, normalizedPurpose as any);
    if (!emailSent) {
      const configStatus = getEmailConfigStatus();
      console.error('❌ Failed to send OTP:', configStatus);
      console.log('🧪 For testing, you may use the configured test OTP if enabled');
    }
    console.log('📨 OTP dispatch attempted (see prior logs for provider response).', {
      email: normalizedEmail,
      purpose: normalizedPurpose
    });
  }).catch((err) => {
    console.error('❌ Background OTP email send error:', err);
  });

  // Add CORS headers BEFORE sending body
  res.setHeader('X-OTP-Status', 'sent');
  res.setHeader('Access-Control-Expose-Headers', 'X-OTP-Status');
  
  sendSuccessResponse(res, {}, 'OTP sent successfully');
}));

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP for email verification
// @access  Public
router.post('/verify-otp', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { email, otp, purpose = 'verification' } = req.body as { email: string; otp: string; purpose?: string };
  const normalizedEmail = String(email || '').toLowerCase().trim();
  let normalizedPurpose = String(purpose || 'verification').toLowerCase().trim();

  if (!normalizedEmail || !otp) {
    throw new ValidationError('Email and OTP are required');
  }

  if (normalizedPurpose === 'signup') normalizedPurpose = 'verification';
  if (!['verification', 'password-reset'].includes(normalizedPurpose)) {
    throw new ValidationError('Invalid purpose');
  }

  // Verify OTP
  const isValid = await verifyOTP(normalizedEmail, otp, normalizedPurpose as any);
  console.log('🔎 OTP verification result:', {
    email: normalizedEmail,
    purpose: normalizedPurpose,
    isValid
  });

  // Optional test OTP support for verification flows
  const allowTestOTP = process.env.ALLOW_TEST_OTP === 'true';
  const testOTPCode = process.env.TEST_OTP_CODE || '123456';
  const isTestOTP = allowTestOTP && otp === testOTPCode;

  if (!isValid && !isTestOTP) {
    throw new ValidationError('Invalid or expired OTP');
  }

  if (isTestOTP) {
    console.log('🧪 Test OTP used for purpose:', normalizedPurpose, ' email:', normalizedEmail);
  }

  if (normalizedPurpose === 'verification') {
    // Mark user as verified
    await User.findOneAndUpdate(
      { email: normalizedEmail },
      { emailVerified: true }
    );
  }

  // Add headers BEFORE sending body
  res.setHeader('X-OTP-Status', 'verified');
  res.setHeader('X-Verification-Status', 'email-verified');
  res.setHeader('Access-Control-Expose-Headers', 'X-OTP-Status, X-Verification-Status');
  
  sendSuccessResponse(res, {}, 'OTP verified successfully');
}));

// @route   POST /api/auth/verify-phone
// @desc    Verify phone number
// @access  Private
router.post('/verify-phone', authenticateToken, asyncHandler(async (req: AuthRequest, res: express.Response) => {
  // TODO: Implement phone verification logic
  // This could involve sending SMS verification codes
  
  sendSuccessResponse(res, {}, 'Phone verification code sent');
}));

// @route   GET /api/auth/test-cors
// @desc    Test CORS configuration for OTP endpoints
// @access  Public
router.get('/test-cors', cors(otpCorsOptions), (req: express.Request, res: express.Response) => {
  console.log('🧪 CORS Test Request:', {
    origin: req.headers.origin,
    method: req.method,
    headers: req.headers
  });
  
  res.status(200).json({
    message: 'CORS test successful for OTP endpoints',
    timestamp: new Date().toISOString(),
    origin: req.headers.origin || 'no-origin',
    cors: 'enabled',
    otpEndpoints: [
      'POST /api/auth/login-request-otp',
      'POST /api/auth/login-verify-otp',
      'POST /api/auth/send-otp',
      'POST /api/auth/verify-otp',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password'
    ]
  });
  
  // Add CORS headers for test response
  res.setHeader('X-OTP-Status', 'test-success');
  res.setHeader('X-Verification-Status', 'cors-enabled');
  res.setHeader('Access-Control-Expose-Headers', 'X-OTP-Status, X-Verification-Status');
});

// Simple SMTP debug endpoint for production checks
router.get('/debug-email', asyncHandler(async (req: express.Request, res: express.Response) => {
  try {
    const { createTransporter } = await import('../services/emailService');
    const { getEmailConfigStatus } = await import('../services/emailService');

    const status = getEmailConfigStatus();
    const transporter = createTransporter({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    });

    const verifyResult = await transporter.verify().then(() => ({ ok: true })).catch((e: any) => ({ ok: false, error: e?.message || String(e) }));

    sendSuccessResponse(res, {
      env: {
        EMAIL_HOST: process.env.EMAIL_HOST || 'smtp.gmail.com',
        EMAIL_PORT: process.env.EMAIL_PORT || '587',
        EMAIL_SECURE: process.env.EMAIL_SECURE || 'false',
        EMAIL_USER_SET: !!process.env.EMAIL_USER,
        EMAIL_PASS_SET: !!process.env.EMAIL_PASS
      },
      status,
      verify: verifyResult
    }, 'SMTP debug');
  } catch (e: any) {
    throw new ValidationError(e?.message || 'SMTP verify failed');
  }
}));

export default router;
