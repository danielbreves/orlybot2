import Message from 'core/model/message';
import { arghelp } from 'core/util';
import { CommandAction, CommandArgument } from './types';
import registry from './registry';
import { flat } from 'core/util/array';
import { loginfo } from 'core/log';

enum CommandPermission {
    USER = 0,
    ADMIN = 1,
}

/**
 * Command class and namespace.
 *
 * You probably want to use `Command.create(...)`.
 * Or maybe `Command.sub(...)` if you're getting
 * advanced
 */
export default class Command {
    /**
     * Keyword to listen for to trigger the command.
     *
     * If this contains spaces, the command must be in 'phrase'
     * mode, and this can be set with `.isPhrase()`.
     */
    public keyword: string;

    /**
     * Callback to run when the command is found in
     * the user's message.
     *
     * If the resolved callback returns a string, that
     * will be sent as a reply to the message.
     */
    public action: CommandAction;

    /**
     * Description to show in help text.
     */
    public description: string;

    /**
     * Arguments to show in help text.
     *
     * These are not validated and defaults aren't
     * automatically assigned.
     */
    public arguments: CommandArgument[] = [];

    /**
     * Minimum permission the user must have to
     * perform the command.
     */
    public permission: CommandPermission = CommandPermission.USER;

    /**
     * Aliases for the command that can be matched on the
     * second pass. If another command has one of these aliases
     * as it's keyword, it'll always be preferred.
     */
    public aliases: string[] = [];

    /**
     * Phrase mode: whether the command must match the entire
     * message term to be considered.
     */
    public phrase: boolean;

    /**
     * Parent command instance, if this is a subcommand.
     */
    public parent?: Command;

    /**
     * Dictionary of subcommands.
     */
    public subcommands: Record<string, Command> = {};

    /**
     * Whether this command is hidden from help text.
     */
    public hidden?: boolean;

    /**
     * Create and register a new command. The resulting object
     * can be chained to set properties.
     *
     * The `action` parameters can also be set via chaining in `.do()`
     *
     * For subcommands, use `Command.sub()` instead of this so they
     * aren't registered.
     *
     * @param keyword Keyword to listen for to trigger the command.
     * @param action Callback to run when the command is found in
     *               the user's message.
     *               If the resolved callback returns a string, that
     *               will be sent as a reply to the message.
     */
    public static create(keyword: string, action?: CommandAction) {
        const command = new this(keyword, action);
        registry.register(command);
        return command;
    }

    /**
     * Create a subcommand that isn't registered. Use within the
     * `.nest()` call of a parent to attach it.
     */
    public static sub(keyword: string, action?: CommandAction) {
        return new this(keyword, action);
    }

    private constructor(keyword: string, action?: CommandAction) {
        this.set({ keyword, action });
    }

    private set(data: Partial<Command>): Command {
        Object.keys(data)
            .filter(key => data[key] !== undefined)
            .forEach(key => (this[key] = data[key]));
        return this;
    }

    /**
     * Set the action callback to run when the command is executed.
     *
     * If the resolved callback returns a string, that
     * will be sent as a reply to the message.
     */
    public do(action: CommandAction) {
        return this.set({ action });
    }

    /**
     * Set the help text description of the command.
     */
    public desc(description: string) {
        return this.set({ description });
    }

    /**
     * Add a help text argument for the command.
     */
    public arg(argument: Partial<CommandArgument>) {
        this.arguments.push({ required: false, name: 'null', ...argument });
        return this;
    }

    /**
     * Make the command admin-only.
     */
    public admin() {
        return this.set({ permission: CommandPermission.ADMIN });
    }

    /**
     * Put the command in phrase mode.
     *
     * Phrase mode: whether the command must match the entire
     * message term to be considered.
     */
    public isPhrase(phrase: boolean = true) {
        return this.set({ phrase });
    }

    /**
     * Add one or more aliases that can be matched on the
     * second pass when resolving a command to run. If another
     * command has one of these aliases as it's keyword, it'll
     * always be preferred.
     */
    public alias(...keywords: string[]) {
        this.aliases.push(...keywords);
        return this;
    }

    /**
     * Add a subcommand.
     *
     * Example usage: `cmd.nest(Command.sub('nested', message => {...}))`
     */
    public nest(subcommand: Command) {
        this.subcommands[subcommand.keyword] = subcommand;
        subcommand.parent = this;
        return this;
    }

    /**
     * Hide the command from help text.
     */
    public hide(hidden: boolean = true) {
        return this.set({ hidden });
    }

    /**
     * Check if this command matches the message's
     * terms on the second pass. Only executed if no
     * command matches the first pass (key lookup).
     */
    public matches(message: Message): boolean {
        if (
            this.phrase &&
            message.text.toLowerCase().startsWith(this.keyword.toLowerCase())
        ) {
            return true;
        }

        return this.aliases.includes(message.firstToken);
    }

    /**
     * Execute the command.
     */
    public async run(message: Message, step: number = 0) {
        loginfo(`Executing command: [${this.keywords}]`);
        if (message.tokens.length >= step) {
            const nextToken = message.tokens[step + 1];
            const matchedSub = Object.values(this.subcommands).find(
                sub =>
                    sub.keyword === nextToken || sub.aliases.includes(nextToken)
            );
            if (matchedSub) {
                return matchedSub.run(message, step + 1);
            }
        }

        const result = await this.action(
            message,
            message.tokens.slice(step + 1)
        );
        if (typeof result === 'string') {
            if (this.permission !== CommandPermission.USER) {
                await message.replyEphemeral(result);
            } else {
                await message.reply(result);
            }
        }
    }

    /**
     * Get all keywords that will trigger the command,
     * including keywords of parents and aliases (split with
     * a pipe `|`).
     */
    public get keywords(): string {
        return [this.commandName, ...this.aliases].join('|');
    }

    /**
     * Get the full name of this command, including
     * parent commands.
     */
    public get commandName(): string {
        return this.parent
            ? `${this.parent.commandName} ${this.keyword}`
            : this.keyword;
    }

    /**
     * Get the help text for this command and all sub
     * commands.
     *
     * Returns an empty array if the command is hidden.
     */
    public get help(): string[] {
        if (this.hidden) return [];
        return [
            [
                this.commandName,
                ...this.arguments.map(arghelp),
                '-',
                this.description,
            ].join(' '),
            ...flat(Object.values(this.subcommands).map(sub => sub.help)),
        ];
    }

    /**
     * Get the help text for this command and all sub
     * commands, including aliases
     *
     * Returns an empty array if the command is hidden.
     */
    public get helpWithAliases(): string[] {
        if (this.hidden) return [];
        return [
            [
                this.keywords,
                ...this.arguments.map(arghelp),
                '-',
                this.description,
            ].join(' '),
            ...flat(Object.values(this.subcommands).map(sub => sub.help)),
        ];
    }
}
