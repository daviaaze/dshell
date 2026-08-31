declare module 'gi://AccountsService?version=1.0' {
    import type GObject from 'gi://GObject?version=2.0';
    export namespace AccountsService {
        class User extends GObject.Object {
            is_system_account(): boolean;
            get_uid(): number;
            get_user_name(): string;
            get_real_name(): string;
            get_icon_file(): string | null;
        }
        class UserManager extends GObject.Object {
            static get_default(): UserManager;
            list_users(): User[];
        }
    }
    const AccountsService: typeof AccountsService;
    export default AccountsService;
}
