import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Job from '../models/Job';
import KYC from '../models/KYC';
import { AdminLogin } from '../models/AdminLogin';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { asyncHandler, sendSuccessResponse, sendErrorResponse, ValidationError } from '../middleware/errorHandler';

const router = express.Router();

// @route   GET /api/admin/stats
// @desc    Get admin dashboard statistics
// @access  Private (Admin only)
router.get('/stats', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const [
    totalUsers,
    totalStudents,
    totalEmployers,
    pendingUserApprovals,
    totalJobs,
    pendingJobApprovals,
    approvedJobs,
    totalApplications
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ userType: 'student' }),
    User.countDocuments({ userType: 'employer' }),
    User.countDocuments({ approvalStatus: 'pending' }),
    Job.countDocuments(),
    Job.countDocuments({ approvalStatus: 'pending' }),
    Job.countDocuments({ approvalStatus: 'approved' }),
    // Note: Application count would need to be added if Application model exists
    0 // Placeholder for now
  ]);

  sendSuccessResponse(res, {
    users: {
      total: totalUsers,
      students: totalStudents,
      employers: totalEmployers,
      pendingApprovals: pendingUserApprovals
    },
    jobs: {
      total: totalJobs,
      pendingApprovals: pendingJobApprovals,
      approved: approvedJobs
    },
    applications: {
      total: totalApplications
    }
  }, 'Admin statistics retrieved successfully');
}));

// @route   GET /api/admin/users/pending
// @desc    Get users pending approval
// @access  Private (Admin only)
router.get('/users/pending', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { page = 1, limit = 10, userType } = req.query;

  const query: any = { approvalStatus: 'pending' };
  if (userType) {
    query.userType = userType;
  }

  const users = await User.find(query)
    .select('-password')
    .sort({ submittedAt: -1 })
    .limit(Number(limit) * 1)
    .skip((Number(page) - 1) * Number(limit));

  const total = await User.countDocuments(query);

  sendSuccessResponse(res, {
    users,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  }, 'Pending users retrieved successfully');
}));

// @route   GET /api/admin/jobs/pending
// @desc    Get jobs pending approval
// @access  Private (Admin only)
router.get('/jobs/pending', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { page = 1, limit = 10 } = req.query;

  const jobs = await Job.find({ approvalStatus: 'pending' })
    .populate('employer', 'name email companyName')
    .sort({ submittedAt: -1 })
    .limit(Number(limit) * 1)
    .skip((Number(page) - 1) * Number(limit));

  const total = await Job.countDocuments({ approvalStatus: 'pending' });

  sendSuccessResponse(res, {
    jobs,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  }, 'Pending jobs retrieved successfully');
}));

// @route   PATCH /api/admin/users/:id/approve
// @desc    Approve a user
// @access  Private (Admin only)
router.patch('/users/:id/approve', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid user ID');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ValidationError('User not found');
  }

  if (user.approvalStatus !== 'pending') {
    throw new ValidationError('User is not pending approval');
  }

  user.approvalStatus = 'approved';
  user.approvedAt = new Date();
  user.approvedBy = req.user!._id;
  await user.save();

  sendSuccessResponse(res, { user }, 'User approved successfully');
}));

// @route   PATCH /api/admin/users/:id/reject
// @desc    Reject a user
// @access  Private (Admin only)
router.patch('/users/:id/reject', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid user ID');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ValidationError('User not found');
  }

  if (user.approvalStatus !== 'pending') {
    throw new ValidationError('User is not pending approval');
  }

  user.approvalStatus = 'rejected';
  user.approvedAt = new Date();
  user.approvedBy = req.user!._id;
  user.rejectionReason = reason;
  await user.save();

  sendSuccessResponse(res, { user }, 'User rejected successfully');
}));

// @route   PATCH /api/admin/jobs/:id/approve
// @desc    Approve a job
// @access  Private (Admin only)
router.patch('/jobs/:id/approve', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid job ID');
  }

  const job = await Job.findById(id);
  if (!job) {
    throw new ValidationError('Job not found');
  }

  if (job.approvalStatus !== 'pending') {
    throw new ValidationError('Job is not pending approval');
  }

  job.approvalStatus = 'approved';
  job.status = 'active'; // Make job active after approval
  job.approvedAt = new Date();
  job.approvedBy = req.user!._id;
  await job.save();

  sendSuccessResponse(res, { job }, 'Job approved successfully');
}));

// @route   PATCH /api/admin/jobs/:id/reject
// @desc    Reject a job
// @access  Private (Admin only)
router.patch('/jobs/:id/reject', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid job ID');
  }

  const job = await Job.findById(id);
  if (!job) {
    throw new ValidationError('Job not found');
  }

  if (job.approvalStatus !== 'pending') {
    throw new ValidationError('Job is not pending approval');
  }

  job.approvalStatus = 'rejected';
  job.status = 'closed'; // Close rejected jobs
  job.approvedAt = new Date();
  job.approvedBy = req.user!._id;
  job.rejectionReason = reason;
  await job.save();

  sendSuccessResponse(res, { job }, 'Job rejected successfully');
}));

// @route   GET /api/admin/kyc
// @desc    Get all KYC submissions for admin review
// @access  Private (Admin only)
router.get('/kyc', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { status = 'all', page = 1, limit = 10 } = req.query;
  
  console.log('🔍 Admin KYC Query - Starting query');
  console.log('  Admin User ID:', req.user!._id);
  console.log('  Query params:', { status, page, limit });
  
  let filter: any = { isActive: true };
  if (status !== 'all') {
    filter.verificationStatus = status;
  }
  
  console.log('🔍 Admin KYC Query - Filter:', JSON.stringify(filter, null, 2));
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const [kycSubmissions, totalCount] = await Promise.all([
    KYC.find(filter)
      .populate('userId', 'name email phone userType')
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    KYC.countDocuments(filter)
  ]);
  
  console.log('📊 Admin KYC Query - Results:');
  console.log('  Total count:', totalCount);
  console.log('  Returned documents:', kycSubmissions.length);
  console.log('  Documents:', kycSubmissions.map(k => ({
    id: k._id,
    userId: k.userId?._id,
    userName: (k.userId as any)?.name,
    userEmail: (k.userId as any)?.email,
    fullName: k.fullName,
    email: k.email,
    phone: k.phone,
    verificationStatus: k.verificationStatus,
    submittedAt: k.submittedAt,
    createdAt: (k as any).createdAt,
    aadharCard: k.aadharCard ? 'Present' : 'Missing',
    collegeIdCard: k.collegeIdCard ? 'Present' : 'Missing'
  })));
  
  sendSuccessResponse(res, {
    kycSubmissions,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
      totalCount,
      hasNext: skip + kycSubmissions.length < totalCount,
      hasPrev: Number(page) > 1
    }
  }, 'KYC submissions retrieved successfully');
}));

// @route   GET /api/admin/kyc/:id
// @desc    Get specific KYC submission details
// @access  Private (Admin only)
router.get('/kyc/:id', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid KYC ID');
  }
  
  const kyc = await KYC.findById(id)
    .populate('userId', 'name email phone userType college');
  
  if (!kyc) {
    throw new ValidationError('KYC submission not found');
  }
  
  sendSuccessResponse(res, { kyc }, 'KYC submission retrieved successfully');
}));

// @route   PUT /api/admin/kyc/:id/approve
// @desc    Approve KYC submission
// @access  Private (Admin only)
router.put('/kyc/:id/approve', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;
  
  console.log('🔍 Admin KYC Approve - Starting approval process');
  console.log('  Admin User ID:', req.user!._id);
  console.log('  KYC ID:', id);
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    console.log('❌ Admin KYC Approve - Invalid KYC ID:', id);
    throw new ValidationError('Invalid KYC ID');
  }
  
  const kyc = await KYC.findById(id);
  if (!kyc) {
    console.log('❌ Admin KYC Approve - KYC not found:', id);
    throw new ValidationError('KYC submission not found');
  }
  
  console.log('📋 Admin KYC Approve - Found KYC:', {
    id: kyc._id,
    userId: kyc.userId,
    fullName: kyc.fullName,
    email: kyc.email,
    currentStatus: kyc.verificationStatus
  });
  
  // Admin has full control - can approve from any status
  console.log('✅ Admin KYC Approve - Admin has full control, proceeding with approval');
  
  kyc.verificationStatus = 'approved';
  kyc.approvedAt = new Date();
  kyc.approvedBy = req.user!._id;
  await kyc.save();
  
  console.log('✅ Admin KYC Approve - KYC approved successfully');
  console.log('  New status:', kyc.verificationStatus);
  console.log('  Approved at:', kyc.approvedAt);
  console.log('  Approved by:', kyc.approvedBy);
  
  // Update user's KYC status
  await User.findByIdAndUpdate(kyc.userId, { 
    kycStatus: 'verified',
    kycVerifiedAt: new Date()
  });
  
  console.log('✅ Admin KYC Approve - User KYC status updated');
  
  sendSuccessResponse(res, { kyc }, 'KYC submission approved successfully');
}));

// @route   PUT /api/admin/kyc/:id/reject
// @desc    Reject KYC submission
// @access  Private (Admin only)
router.put('/kyc/:id/reject', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  
  console.log('🔍 Admin KYC Reject - Starting rejection process');
  console.log('  Admin User ID:', req.user!._id);
  console.log('  KYC ID:', id);
  console.log('  Rejection reason:', reason);
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    console.log('❌ Admin KYC Reject - Invalid KYC ID:', id);
    throw new ValidationError('Invalid KYC ID');
  }
  
  if (!reason || reason.trim().length === 0) {
    console.log('❌ Admin KYC Reject - Missing rejection reason');
    throw new ValidationError('Rejection reason is required');
  }
  
  const kyc = await KYC.findById(id);
  if (!kyc) {
    console.log('❌ Admin KYC Reject - KYC not found:', id);
    throw new ValidationError('KYC submission not found');
  }
  
  console.log('📋 Admin KYC Reject - Found KYC:', {
    id: kyc._id,
    userId: kyc.userId,
    fullName: kyc.fullName,
    email: kyc.email,
    currentStatus: kyc.verificationStatus
  });
  
  // Admin has full control - can reject from any status
  console.log('✅ Admin KYC Reject - Admin has full control, proceeding with rejection');
  
  kyc.verificationStatus = 'rejected';
  kyc.rejectedAt = new Date();
  kyc.rejectedBy = req.user!._id;
  kyc.rejectionReason = reason;
  await kyc.save();
  
  console.log('✅ Admin KYC Reject - KYC rejected successfully');
  console.log('  New status:', kyc.verificationStatus);
  console.log('  Rejected at:', kyc.rejectedAt);
  console.log('  Rejected by:', kyc.rejectedBy);
  console.log('  Rejection reason:', kyc.rejectionReason);
  
  // Update user's KYC status
  await User.findByIdAndUpdate(kyc.userId, { 
    kycStatus: 'rejected',
    kycRejectedAt: new Date()
  });
  
  console.log('✅ Admin KYC Reject - User KYC status updated');
  
  sendSuccessResponse(res, { kyc }, 'KYC submission rejected successfully');
}));

// @route   PUT /api/admin/kyc/:id/pending
// @desc    Set KYC submission to pending status
// @access  Private (Admin only)
router.put('/kyc/:id/pending', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;
  
  console.log('🔍 Admin KYC Pending - Starting pending process');
  console.log('  KYC ID:', id);
  console.log('  Admin User ID:', req.user!._id);
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    console.log('❌ Admin KYC Pending - Invalid KYC ID');
    return sendErrorResponse(res, 400, 'Invalid KYC ID');
  }
  
  const kyc = await KYC.findById(id).populate('userId', 'name email phone userType');
  
  if (!kyc) {
    console.log('❌ Admin KYC Pending - KYC not found');
    return sendErrorResponse(res, 404, 'KYC submission not found');
  }
  
  console.log('✅ Admin KYC Pending - KYC found:', {
    id: kyc._id,
    userId: kyc.userId,
    currentStatus: kyc.verificationStatus
  });
  
  // Update KYC status to pending
  kyc.verificationStatus = 'pending';
  kyc.lastUpdated = new Date();
  await kyc.save();
  
  console.log('✅ Admin KYC Pending - KYC status updated to pending');
  
  // Update user's KYC status
  await User.findByIdAndUpdate(kyc.userId, { 
    kycStatus: 'pending',
    kycPendingAt: new Date()
  });
  
  console.log('✅ Admin KYC Pending - User KYC status updated');
  
  sendSuccessResponse(res, { kyc }, 'KYC submission set to pending successfully');
}));

// @route   GET /api/admin/kyc/stats
// @desc    Get KYC statistics for admin dashboard
// @access  Private (Admin only)
router.get('/kyc/stats', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  console.log('🔍 Admin KYC Stats - Starting stats query');
  console.log('  Admin User ID:', req.user!._id);
  
  const [
    totalKYC,
    pendingKYC,
    approvedKYC,
    rejectedKYC
  ] = await Promise.all([
    KYC.countDocuments({ isActive: true }),
    KYC.countDocuments({ verificationStatus: 'pending', isActive: true }),
    KYC.countDocuments({ verificationStatus: 'approved', isActive: true }),
    KYC.countDocuments({ verificationStatus: 'rejected', isActive: true })
  ]);
  
  const stats = {
    total: totalKYC,
    pending: pendingKYC,
    approved: approvedKYC,
    rejected: rejectedKYC
  };
  
  console.log('📊 Admin KYC Stats - Results:', stats);
  
  sendSuccessResponse(res, stats, 'KYC statistics retrieved successfully');
}));

// @route   GET /api/admin/users
// @desc    Get all users with optional filtering
// @access  Private (Admin only)
router.get('/users', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { page = 1, limit = 10, userType, status } = req.query;

  let filter: any = {};
  if (userType) {
    filter.userType = userType;
  }
  if (status) {
    filter.approvalStatus = status;
  }

  const users = await User.find(filter)
    .select('-password')
    .sort({ createdAt: -1 })
    .limit(Number(limit) * 1)
    .skip((Number(page) - 1) * Number(limit));

  const total = await User.countDocuments(filter);

  sendSuccessResponse(res, {
    users,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  }, 'Users retrieved successfully');
}));

// @route   DELETE /api/admin/users/:id
// @desc    Delete a user (soft delete)
// @access  Private (Admin only)
router.delete('/users/:id', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid user ID');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ValidationError('User not found');
  }

  // Prevent admin from deleting themselves
  if ((user._id as any).toString() === (req.user!._id as string).toString()) {
    throw new ValidationError('Cannot delete your own account');
  }

  // Soft delete by setting isActive to false
  user.isActive = false;
  await user.save();

  sendSuccessResponse(res, {}, 'User deleted successfully');
}));

// @route   PATCH /api/admin/users/:id/suspend
// @desc    Suspend a user
// @access  Private (Admin only)
router.patch('/users/:id/suspend', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid user ID');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ValidationError('User not found');
  }

  // Prevent admin from suspending themselves
  if ((user._id as any).toString() === (req.user!._id as string).toString()) {
    throw new ValidationError('Cannot suspend your own account');
  }

  user.isActive = false;
  await user.save();

  sendSuccessResponse(res, { user }, 'User suspended successfully');
}));

// @route   PATCH /api/admin/users/:id/activate
// @desc    Activate a user
// @access  Private (Admin only)
router.patch('/users/:id/activate', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError('Invalid user ID');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ValidationError('User not found');
  }

  user.isActive = true;
  await user.save();

  sendSuccessResponse(res, { user }, 'User activated successfully');
}));

// @route   GET /api/admin/login-history
// @desc    Get admin login history
// @access  Private (Admin only)
router.get('/login-history', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { page = 1, limit = 20, status, adminId, startDate, endDate } = req.query;
  
  // Build filter object
  const filter: any = {};
  
  if (status && ['success', 'failed'].includes(status as string)) {
    filter.loginStatus = status;
  }
  
  if (adminId && mongoose.Types.ObjectId.isValid(adminId as string)) {
    filter.adminId = new mongoose.Types.ObjectId(adminId as string);
  }
  
  if (startDate || endDate) {
    filter.loginTime = {};
    if (startDate) {
      filter.loginTime.$gte = new Date(startDate as string);
    }
    if (endDate) {
      filter.loginTime.$lte = new Date(endDate as string);
    }
  }
  
  // Calculate pagination
  const skip = (Number(page) - 1) * Number(limit);
  
  // Get login history with pagination
  const [loginHistory, totalCount] = await Promise.all([
    AdminLogin.find(filter)
      .populate('adminId', 'name email')
      .sort({ loginTime: -1 })
      .skip(skip)
      .limit(Number(limit)),
    AdminLogin.countDocuments(filter)
  ]);
  
  // Calculate pagination info
  const totalPages = Math.ceil(totalCount / Number(limit));
  
  sendSuccessResponse(res, {
    loginHistory,
    pagination: {
      currentPage: Number(page),
      totalPages,
      totalCount,
      hasNext: Number(page) < totalPages,
      hasPrev: Number(page) > 1
    }
  }, 'Admin login history retrieved successfully');
}));

// @route   GET /api/admin/login-stats
// @desc    Get admin login statistics
// @access  Private (Admin only)
router.get('/login-stats', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  const { days = 30 } = req.query;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Number(days));
  
  // Get login statistics
  const [
    totalLogins,
    successfulLogins,
    failedLogins,
    uniqueAdmins,
    recentLogins
  ] = await Promise.all([
    AdminLogin.countDocuments({ loginTime: { $gte: startDate } }),
    AdminLogin.countDocuments({ 
      loginTime: { $gte: startDate },
      loginStatus: 'success'
    }),
    AdminLogin.countDocuments({ 
      loginTime: { $gte: startDate },
      loginStatus: 'failed'
    }),
    AdminLogin.distinct('adminId', { loginTime: { $gte: startDate } }),
    AdminLogin.find({ loginTime: { $gte: startDate } })
      .populate('adminId', 'name email')
      .sort({ loginTime: -1 })
      .limit(10)
  ]);
  
  // Get daily login counts for the last 7 days
  const dailyStats = await AdminLogin.aggregate([
    {
      $match: {
        loginTime: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$loginTime' }
        },
        successCount: {
          $sum: { $cond: [{ $eq: ['$loginStatus', 'success'] }, 1, 0] }
        },
        failedCount: {
          $sum: { $cond: [{ $eq: ['$loginStatus', 'failed'] }, 1, 0] }
        }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
  
  sendSuccessResponse(res, {
    period: `${days} days`,
    totalLogins,
    successfulLogins,
    failedLogins,
    successRate: totalLogins > 0 ? ((successfulLogins / totalLogins) * 100).toFixed(2) : 0,
    uniqueAdmins: uniqueAdmins.length,
    recentLogins,
    dailyStats
  }, 'Admin login statistics retrieved successfully');
}));

// @route   GET /api/admin/dashboard-data
// @desc    Get comprehensive admin dashboard data
// @access  Private (Admin only)
router.get('/dashboard-data', authenticateToken, requireRole(['admin']), asyncHandler(async (req: AuthRequest, res: express.Response) => {
  try {
    // Get KYC data with student details
    const kycData = await KYC.find({})
      .populate('userId', 'name email phone college skills isActive emailVerified phoneVerified approvalStatus')
      .sort({ submittedAt: -1 });

    // Get admin login history
    const loginHistory = await AdminLogin.find({})
      .populate('adminId', 'name email')
      .sort({ loginTime: -1 })
      .limit(20);

    // Get statistics
    const [
      totalKYC,
      pendingKYC,
      approvedKYC,
      rejectedKYC,
      totalLogins,
      successfulLogins,
      failedLogins,
      totalStudents,
      totalEmployers
    ] = await Promise.all([
      KYC.countDocuments(),
      KYC.countDocuments({ verificationStatus: 'pending' }),
      KYC.countDocuments({ verificationStatus: 'approved' }),
      KYC.countDocuments({ verificationStatus: 'rejected' }),
      AdminLogin.countDocuments(),
      AdminLogin.countDocuments({ loginStatus: 'success' }),
      AdminLogin.countDocuments({ loginStatus: 'failed' }),
      User.countDocuments({ userType: 'student' }),
      User.countDocuments({ userType: 'employer' })
    ]);

    // Format KYC data
    const formattedKYC = kycData.map(kyc => ({
      _id: kyc._id,
      studentId: kyc.userId._id,
      studentName: kyc.fullName,
      studentEmail: kyc.email,
      studentPhone: kyc.phone,
      college: kyc.college,
      courseYear: kyc.courseYear,
      status: kyc.verificationStatus,
      submittedAt: kyc.submittedAt,
      approvedAt: kyc.approvedAt,
      approvedBy: kyc.approvedBy,
      rejectedAt: kyc.rejectedAt,
      rejectedBy: kyc.rejectedBy,
      rejectionReason: kyc.rejectionReason,
      documents: {
        aadharCard: kyc.aadharCard,
        collegeIdCard: kyc.collegeIdCard
      },
      availability: {
        hoursPerWeek: kyc.hoursPerWeek,
        availableDays: kyc.availableDays,
        stayType: kyc.stayType
      },
      jobPreferences: {
        preferredJobTypes: kyc.preferredJobTypes,
        experienceSkills: kyc.experienceSkills
      },
      emergencyContact: kyc.emergencyContact,
      payroll: kyc.payroll,
      userDetails: kyc.userId && typeof kyc.userId === 'object' && 'name' in kyc.userId ? {
        name: (kyc.userId as any).name,
        email: (kyc.userId as any).email,
        phone: (kyc.userId as any).phone,
        college: (kyc.userId as any).college,
        skills: (kyc.userId as any).skills,
        isActive: (kyc.userId as any).isActive,
        emailVerified: (kyc.userId as any).emailVerified,
        phoneVerified: (kyc.userId as any).phoneVerified,
        approvalStatus: (kyc.userId as any).approvalStatus
      } : null
    }));

    // Format login history
    const formattedLogins = loginHistory.map(login => ({
      _id: login._id,
      adminId: login.adminId && typeof login.adminId === 'object' && '_id' in login.adminId ? (login.adminId as any)._id : login.adminId,
      adminName: login.adminName,
      adminEmail: login.adminEmail,
      loginTime: login.loginTime,
      loginStatus: login.loginStatus,
      ipAddress: login.ipAddress,
      userAgent: login.userAgent,
      failureReason: login.failureReason,
      sessionDuration: login.sessionDuration,
      logoutTime: login.logoutTime
    }));

    // Calculate success rate
    const loginSuccessRate = totalLogins > 0 ? ((successfulLogins / totalLogins) * 100).toFixed(2) : 0;
    const kycApprovalRate = totalKYC > 0 ? ((approvedKYC / totalKYC) * 100).toFixed(2) : 0;

    sendSuccessResponse(res, {
      kycData: formattedKYC,
      loginHistory: formattedLogins,
      statistics: {
        kyc: {
          total: totalKYC,
          pending: pendingKYC,
          approved: approvedKYC,
          rejected: rejectedKYC,
          approvalRate: kycApprovalRate
        },
        logins: {
          total: totalLogins,
          successful: successfulLogins,
          failed: failedLogins,
          successRate: loginSuccessRate
        },
        users: {
          students: totalStudents,
          employers: totalEmployers,
          total: totalStudents + totalEmployers
        }
      }
    }, 'Admin dashboard data retrieved successfully');
  } catch (error) {
    console.error('Error fetching admin dashboard data:', error);
    throw new ValidationError('Failed to fetch admin dashboard data');
  }
}));

export default router;