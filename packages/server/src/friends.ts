// Friend graph used by the boards (DB-012, API-016). Referrals are not in this iteration, so the
// default provider has no friends and the board shows only the player. Tests and the next iteration
// pass another provider.

export interface FriendsProvider {
  friendIds(userId: string): Promise<readonly string[]>;
}

export const NO_FRIENDS: FriendsProvider = {
  friendIds: async () => [],
};
