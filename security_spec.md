# Security Specification: Phase 5 Flight Tracker

## Data Invariants
1. **Personnel Integrity**: A personnel record must include a full name and a valid employee ID.
2. **Schedule Coherence**: On-duty schedules must have a start date strictly before the end date.
3. **Request Validity**: Every flight request must reference an existing personnel ID and a valid scheduling block.
4. **Identity**: All records created must be verifiable.

## The "Dirty Dozen" (Attack Payloads)
1. **Shadow Field Injection**: `{"fullName": "John Doe", "role": "Driller", "isAdmin": true}` -> Should be rejected by `hasOnly`.
2. **Orphaned Request**: Creating a flight request with a non-existent `personnelId`.
3. **Identity Spoofing**: User A trying to update User B's personnel details (if we implement user-specific profiles).
4. **Status Escalation**: Personnel trying to mark their own flight request as "BOOKED" without being an authorized travel admin.
5. **PII Scraping**: Trying to list all personnel without filtering (blanket reads).
6. **Large Payload Attack**: Injecting 1MB of junk data into the `fullName` field.
7. **Negative Duration**: `startDate` being after `endDate`.
8. **Unauthorized Deletion**: Deleting historical flight records to hide costs.
9. **Timeline Tampering**: Changing the `createdAt` timestamp of a request.
10. **Role Hijacking**: Modifying the `role` field after creation.
11. **ID Poisoning**: Using a 1KB string as a document ID.
12. **Unverified Write**: Writing data without a verified email.

## Test Strategy (draft)
- All writes must include `request.auth.token.email_verified == true`.
- Update calls must use `affectedKeys().hasOnly()`.
- `create` calls must enforce exact schema sizes.
