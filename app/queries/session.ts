import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

export function useSession() {
	return useQuery({
		queryKey: queryKeys.session(),
		queryFn: () => api.getSession(),
		staleTime: 15_000,
	});
}

export function useConfig() {
	return useQuery({
		queryKey: queryKeys.config(),
		queryFn: () => api.getConfig(),
		staleTime: 60_000,
	});
}
