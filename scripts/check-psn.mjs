import {
  DEFAULT_PSN_LOGIN_NAME,
  DEFAULT_PSN_ONLINE_ID,
  getPsnSession,
  isBackupPsnAccount,
} from "../lib/psn/session.ts";

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

const session = getPsnSession();
expect(DEFAULT_PSN_LOGIN_NAME === "barleezyfbaby", "default login is barleezyfbaby");
expect(DEFAULT_PSN_ONLINE_ID === "Barleezybaby", "default online id is Barleezybaby");
expect(isBackupPsnAccount("Barleezybaby"), "verified Sony online id matches");
expect(isBackupPsnAccount("BarleezyFBaby"), "requested backup alias matches");
expect(isBackupPsnAccount("barleezyfbaby"), "login casing matches");
expect(!isBackupPsnAccount("TTBarleezy"), "other names are not the backup");
expect(session.loginName.toLowerCase() === "barleezyfbaby", "session login is backup");
expect(session.onlineId === "BarleezyFBaby" || isBackupPsnAccount(session.onlineId), "session online id is backup");
expect(session.belongsToBackup, "session belongs to BarleezyFBaby");
console.log("psn check ok");
