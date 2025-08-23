export const boundSessionById = (arrSessions, arrGroupID) => {
    let idsDisponiveis = [...arrGroupID];
    let mapper = [];

    idsDisponiveis = idsDisponiveis
        .map(id => ({ id, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ id }) => id);

    for (let i = 0; i < idsDisponiveis.length; i++) {
        const session = arrSessions[i % arrSessions.length];
        const id = idsDisponiveis[i];
        mapper.push([session, id]);
    }

    return mapper;
}