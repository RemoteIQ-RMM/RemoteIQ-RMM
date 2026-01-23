import { Body, Controller, Post } from "@nestjs/common";
import { EndpointsService, CreateEndpointDto, CreateEndpointResponse } from "./endpoints.service";

@Controller("endpoints") // if you use global prefix "api", this becomes /api/endpoints
export class EndpointsController {
    constructor(private readonly endpoints: EndpointsService) { }

    @Post()
    async create(@Body() body: CreateEndpointDto): Promise<CreateEndpointResponse> {
        return await this.endpoints.createEndpoint(body);
    }
}
