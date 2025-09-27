import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import User from '../models/User';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userType?: string;
  userEmail?: string;
}

class SocketManager {
  private io: SocketIOServer;
  private connectedUsers: Map<string, string> = new Map(); // userId -> socketId

  constructor(server: HTTPServer) {
    // Environment-aware CORS configuration
    const isProduction = process.env.NODE_ENV === 'production';
    const allowedOrigins = isProduction 
      ? ['https://me-work.vercel.app']
      : ['http://localhost:3000'];
    
    this.io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
      },
      // Enable connection state recovery
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      }
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    
    console.log('🔌 Socket.IO server initialized with CORS:', 'environment-aware');
    console.log(`   Allowed origins: ${allowedOrigins.join(', ')}`);
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket: Socket, next) => {
      try {
        const authSocket = socket as AuthenticatedSocket;
        
        // Get token from auth object or headers
        const token = authSocket.handshake.auth?.token || 
                     authSocket.handshake.headers?.authorization?.replace('Bearer ', '');
        
        console.log('🔐 Socket authentication attempt:', {
          hasToken: !!token,
          socketId: authSocket.id,
          userAgent: authSocket.handshake.headers['user-agent']
        });
        
        if (!token) {
          console.log('❌ No token provided for socket connection');
          return next(new Error('Authentication error: No token provided'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        console.log('🔐 Token decoded successfully:', { userId: decoded.userId });
        
        // Find user in database
        const user = await User.findById(decoded.userId).select('_id email userType name') as any;
        
        if (!user) {
          console.log('❌ User not found for socket connection:', decoded.userId);
          return next(new Error('Authentication error: User not found'));
        }

        // Attach user info to socket
        authSocket.userId = user._id.toString();
        authSocket.userType = user.userType;
        authSocket.userEmail = user.email;
        
        console.log('✅ Socket authenticated successfully:', {
          userId: authSocket.userId,
          userType: authSocket.userType,
          userEmail: authSocket.userEmail
        });
        
        next();
      } catch (error) {
        console.error('❌ Socket authentication error:', error);
        next(new Error('Authentication error: Invalid token'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: Socket) => {
      const authSocket = socket as AuthenticatedSocket;
      console.log(`🔌 Socket connected: ${authSocket.userEmail} (${authSocket.userType}) - Socket ID: ${authSocket.id}`);
      
      // Store user connection
      if (authSocket.userId) {
        this.connectedUsers.set(authSocket.userId, authSocket.id);
        console.log(`📊 Total connected users: ${this.connectedUsers.size}`);
      }

      // Join user to their personal room
      if (authSocket.userId) {
        authSocket.join(`user:${authSocket.userId}`);
        console.log(`🔌 User joined personal room: user:${authSocket.userId}`);
      }

      // Join role-specific rooms
      if (authSocket.userType) {
        authSocket.join(authSocket.userType);
        console.log(`🔌 User joined role room: ${authSocket.userType}`);
      }

      // Join admin to admin room
      if (authSocket.userType === 'admin') {
        authSocket.join('admin');
        console.log(`🔌 Admin joined admin room`);
      }

      // Send connection confirmation
      authSocket.emit('connected', {
        message: 'Successfully connected to server',
        userId: authSocket.userId,
        userType: authSocket.userType,
        socketId: authSocket.id,
        timestamp: new Date().toISOString()
      });

      // Handle disconnect
      authSocket.on('disconnect', (reason) => {
        console.log(`🔌 Socket disconnected: ${authSocket.userEmail} - Reason: ${reason}`);
        if (authSocket.userId) {
          this.connectedUsers.delete(authSocket.userId);
          console.log(`📊 Total connected users: ${this.connectedUsers.size}`);
        }
      });

      // Handle joining job-specific room
      authSocket.on('join_job_room', (jobId: string) => {
        authSocket.join(`job:${jobId}`);
        console.log(`🔌 User ${authSocket.userEmail} joined job room: ${jobId}`);
      });

      // Handle leaving job-specific room
      authSocket.on('leave_job_room', (jobId: string) => {
        authSocket.leave(`job:${jobId}`);
        console.log(`🔌 User ${authSocket.userEmail} left job room: ${jobId}`);
      });

      // Handle KYC status requests
      authSocket.on('kyc:status:request', () => {
        if (authSocket.userId) {
          authSocket.emit('kyc:status:response', {
            userId: authSocket.userId,
            timestamp: new Date()
          });
        }
      });

      // Handle ping/pong for connection health
      authSocket.on('ping', () => {
        authSocket.emit('pong', { timestamp: new Date().toISOString() });
      });
    });
  }

  // Emit KYC status update to specific user
  public emitKYCStatusUpdate(userId: string, statusData: any) {
    console.log(`📡 Emitting KYC status update to user: ${userId}`);
    
    // Emit to user's personal room
    this.io.to(`user:${userId}`).emit('kyc:status:update', {
      ...statusData,
      timestamp: new Date()
    });

    // Also emit to admin room for real-time admin dashboard updates
    this.io.to('admin').emit('kyc:admin:update', {
      userId,
      ...statusData,
      timestamp: new Date()
    });
  }

  // Emit job approval notification to all students
  public emitJobApproval(jobId: string, jobData: any) {
    console.log(`📡 Emitting job approval notification for job: ${jobId}`);
    
    // Emit to all connected users (students will filter this on frontend)
    this.io.emit('job:approved', {
      jobId,
      job: jobData,
      timestamp: new Date()
    });
    
    console.log(`✅ Job approval notification sent for job: ${jobId}`);
  }

  // Emit new application notification to employer
  public emitNewApplication(employerId: string, applicationData: any) {
    console.log(`📡 Emitting new application notification to employer: ${employerId}`);
    
    // Emit to employer's personal room
    this.io.to(`user:${employerId}`).emit('application:new', {
      ...applicationData,
      timestamp: new Date()
    });
    
    console.log(`✅ New application notification sent to employer: ${employerId}`);
  }

  // Emit to all admins
  public emitToAdmins(event: string, data: any) {
    console.log(`📡 Emitting to admins: ${event}`);
    this.io.to('admin').emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  // Emit to specific user
  public emitToUser(userId: string, event: string, data: any) {
    console.log(`📡 Emitting to user ${userId}: ${event}`);
    this.io.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  // Get connected users count
  public getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  // Check if user is connected
  public isUserConnected(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  // ===== JOB-RELATED NOTIFICATIONS =====

  // Emit job approval notification to all students
  public notifyJobApproved(jobData: any) {
    console.log(`📢 Broadcasting job approval: ${jobData.jobTitle} at ${jobData.companyName}`);
    
    this.io.to('student').emit('job_approved', {
      type: 'job_approved',
      job: jobData,
      timestamp: new Date().toISOString(),
      message: `New job approved: ${jobData.jobTitle} at ${jobData.companyName}`
    });
  }

  // Emit job rejection notification to employer
  public notifyJobRejected(jobData: any, employerId: string) {
    console.log(`📢 Notifying job rejection to employer: ${employerId}`);
    
    this.io.to(`user:${employerId}`).emit('job_rejected', {
      type: 'job_rejected',
      job: jobData,
      timestamp: new Date().toISOString(),
      message: `Your job "${jobData.jobTitle}" was rejected`
    });
  }

  // Emit new application notification to employer
  public notifyNewApplication(applicationData: any, employerId: string) {
    console.log(`📢 Notifying new application to employer: ${employerId}`);
    
    this.io.to(`user:${employerId}`).emit('new_application', {
      type: 'new_application',
      application: applicationData,
      timestamp: new Date().toISOString(),
      message: `New application received for "${applicationData.jobTitle}"`
    });

    // Also notify in job-specific room
    this.io.to(`job:${applicationData.jobId}`).emit('new_application', {
      type: 'new_application',
      application: applicationData,
      timestamp: new Date().toISOString(),
      message: `New application received for "${applicationData.jobTitle}"`
    });
  }

  // Emit application status update to student
  public notifyApplicationStatusUpdate(applicationData: any, studentId: string) {
    console.log(`📢 Notifying application status update to student: ${studentId}`);
    
    this.io.to(`user:${studentId}`).emit('application_status_update', {
      type: 'application_status_update',
      application: applicationData,
      timestamp: new Date().toISOString(),
      message: `Your application status updated: ${applicationData.status}`
    });
  }

  // Get socket instance
  public getIO(): SocketIOServer {
    return this.io;
  }
}

export default SocketManager;
