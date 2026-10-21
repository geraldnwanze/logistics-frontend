"use client";

import { RequireUser } from "./require-user";
import { AccountNav } from "./account-nav";
import { PasswordForm } from "./password-form";
import { PrivacyPanel } from "./privacy-panel";
import { ProfileForm } from "./profile-form";

export function ProfileView() {
  return (
    <RequireUser page="/account/profile">
      {(user) => (
        <>
          <AccountNav current="/account/profile" />
          <div className="space-y-8">
            <ProfileForm user={user} />
            <PrivacyPanel user={user} />
          </div>
        </>
      )}
    </RequireUser>
  );
}

export function PasswordView() {
  return (
    <RequireUser page="/account/password">
      {() => (
        <>
          <AccountNav current="/account/password" />
          <PasswordForm />
        </>
      )}
    </RequireUser>
  );
}
