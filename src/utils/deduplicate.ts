/**
 * Deduplication Engine
 * Solves the "Shared Inventory" double-counting problem between BMS and Paytm.
 */

export interface RawSession {
    movie: string;
    rawTitle: string;
    venue: string;
    chain: string;
    city: string;
    state: string;
    time: string;
    audi: string;
    sessionId: string;
    totalSeats: number;
    availableSeats: number;
    soldSeats: number;
    grossRevenue: number;
    source: 'BMS' | 'PAYTM' | 'JUSTICKETS' | 'PIC';
    availStatus: number;
}

export function deduplicateSessions(bmsSessions: RawSession[], paytmSessions: RawSession[]): RawSession[] {
    const finalSessions: RawSession[] = [];
    const bmsVenueCache = new Set<string>();

    // 1. Process BookMyShow (Primary Source)
    // We trust BMS data first and foremost.
    for (const session of bmsSessions) {
        // Create a unique key for the venue + city
        const venueKey = `${session.venue.toLowerCase()}_${session.city.toLowerCase()}`;
        bmsVenueCache.add(venueKey);
        finalSessions.push(session);
    }

    // 2. Process Paytm (Secondary Source)
    // We ONLY include Paytm sessions if the theater does NOT exist in BMS.
    let skippedPaytmCount = 0;
    for (const session of paytmSessions) {
        const venueKey = `${session.venue.toLowerCase()}_${session.city.toLowerCase()}`;
        
        // If BMS already scraped this venue, we discard the Paytm data 
        // to prevent double-counting shared inventory seats.
        if (bmsVenueCache.has(venueKey)) {
            skippedPaytmCount++;
            continue;
        }

        finalSessions.push(session);
    }

    console.log(`🧹 Deduplication complete. Skipped ${skippedPaytmCount} duplicate Paytm sessions to prevent double-counting.`);
    return finalSessions;
}
