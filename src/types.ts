export interface Personnel {
  id: string;
  fullName: string;
  title: string;
  email: string;
  rosterGroup: string;
  employeeId?: string;
  phone?: string;
}

export type ScheduleStatus = 'ON_DUTY' | 'OFF_DUTY' | 'TRANSIT';

export interface Scheduling {
  id: string;
  personnelId: string;
  startDate: string;
  endDate: string;
  status: ScheduleStatus;
}

export interface HubEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  type: 'general' | 'meeting' | 'walkthrough' | 'holiday';
}

export type FlightStatus = 'Requested' | 'Not Received' | 'Received' | 'Need Action' | 'Not Requested';
export type FlightType = 'Algeria to Indonesia' | 'Indonesia to Algeria';

export interface FlightRequest {
  id: string;
  personnelId: string;
  schedulingId?: string;
  startDate?: string;
  endDate?: string;
  type: FlightType;
  requestedDateDZtoID?: string;
  requestedDateIDtoDZ?: string;
  statusDZtoID?: FlightStatus; // Independent status
  statusIDtoDZ?: FlightStatus; // Independent status
  status: FlightStatus; // Legacy aggregate
  bookingReference?: string;
  airline?: string;
  flightNumber?: string;
  createdAt: any;
}

export interface DashboardStats {
  totalPersonnel: number;
  onDutyCount: number;
  pendingFlights: number;
  upcomingFlights: number;
}
