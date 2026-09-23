// 宿主半边：纯挂载载体。插件实体在客户端半边（lib/client.js）。
// 宿主只要求 name 与包名一致、空 inject、空 apply（见 docs/idea.md 附录）。
exports.name = 'dsh-codinput';
exports.inject = [];
exports.apply = () => {};
